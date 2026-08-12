// Shared logic for the MiniMax H3 video tools (fl2va / ref2va):
// aspect presets, duration→frame-length grid, ComfyUI workflow builder with
// optional first/last-frame and reference images, LoRA stacking, the Grok
// "build prompt" call, and the RunPod run/poll helper.

import { invoke } from '../hooks/useTauri';

export const GROK_MODEL = 'grok-4.5';

// H3 native canvas: short side 768, capped 1344 on the long side, multiples of 32.
export const ASPECT_PRESETS = [
  { id: '9:16', label: '9:16 вертикальное — 768×1344 (наш дефолт)', width: 768, height: 1344 },
  { id: '16:9', label: '16:9 широкое — 1344×768', width: 1344, height: 768 },
  { id: '1:1', label: '1:1 квадрат — 1024×1024', width: 1024, height: 1024 },
  { id: '3:4', label: '3:4 портрет — 896×1152', width: 896, height: 1152 },
  { id: '4:3', label: '4:3 альбом — 1152×896', width: 1152, height: 896 },
];
export const DEFAULT_ASPECT = '9:16';

export const OUTPUT_FORMATS = [
  { id: 'auto', label: 'MP4 (H.264 + AAC)' },
];

// The model tops out around 15 s at 24 fps. Frame length must land on the
// 17k+5 grid; seconds → nearest valid length (snapping up).
export const FPS = 24;
export const MAX_SECONDS = 15;
// Frame length must land on the 17k+5 grid; snap seconds→nearest valid length.
export function secondsToFrames(seconds) {
  const target = Math.max(1, Math.min(MAX_SECONDS, seconds)) * FPS;
  let k = Math.max(0, Math.round((target - 5) / 17));
  return 17 * k + 5;
}

// Model filenames present on each endpoint's worker (from the HF mirrors).
export const UNET = {
  fl2va: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  ref2va: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
};
const CLIP = 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors';
const VAE_VIDEO = 'minimax_h3_video_vae_fp16.safetensors';
const VAE_AUDIO = 'minimax_h3_audio_vae_fp32.safetensors';

// LoRA registry. Trigger words / usage guidance are NOT hardcoded here — the
// user supplies them per-lora in Settings (instrKey), and buildGrokInstruction
// injects that text only when the lora's checkbox is enabled.
export const LORAS = [
  {
    id: 'hmpussy',
    label: 'HMPussy (анатомия)',
    instrKey: 'LoraHmpussyInstr',
    files: [
      { url: 'https://huggingface.co/nikdevs/minimax-h3-loras/resolve/main/hmpussy/vagassist_e40.safetensors', strength: 1.0 },
      { url: 'https://huggingface.co/nikdevs/minimax-h3-loras/resolve/main/hmpussy/hmpussy_v6_epoch30.safetensors', strength: 0.35 },
    ],
  },
  {
    id: 'riding',
    label: 'Riding POV (i2v)',
    instrKey: 'LoraRidingInstr',
    files: [
      { url: 'https://huggingface.co/nikdevs/minimax-h3-loras/resolve/main/riding/riding_pose_H3_i2v_v1.0.safetensors', strength: 0.6 },
    ],
  },
];

// Built-in SFW structural example shown to Grok for the ref tool (demonstrates
// the Image N / Video N referencing format). User examples are appended after.
export const REF_STRUCTURE_EXAMPLE =
  'The warrior woman from Image 1 performs the energetic shuffle dance routine from Video 1. ' +
  'Holding her slender sword lightly in one hand, she matches the fast footwork, leg kicks, and jump cadence ' +
  'of the dancer in Video 1. Her long red and white hanfu robes billow and sway dynamically around her legs ' +
  'with every fast step. The background retains the dimly lit corridor with warm, softly glowing paper lanterns ' +
  'from Image 1. Maintain the static low-angle camera framing [static] and perspective from Video 1, keeping her ' +
  'entire body in frame throughout. Cinematic warm lighting with glowing bokeh lanterns behind her. ' +
  'Audio: use the energetic dance music track from Video 1, with the subtle rustle of silk robes and shoe taps ' +
  'synchronized to her movements.';

// Build the Grok system instruction + user message. The custom prepend line
// (settings.GrokPrepend) becomes the first line of BOTH, verbatim.
export function buildGrokMessages({ tool, description, settings, enabledLoras }) {
  const ak = settings?.api_keys || {};
  const prepend = (ak.GrokPrepend || '').trim();

  const lines = [];
  if (prepend) lines.push(prepend);
  lines.push(
    'You convert a user\'s free-form scene description (written in any language) into ONE polished English ' +
    'prompt for the MiniMax H3 video model. H3 generates video WITH native audio, so describe the scene, camera ' +
    'motion, and the accompanying sound (dialogue, SFX, music) in a single coherent block. Output ONLY the final ' +
    'English prompt — no preamble, no quotes, no explanation.'
  );

  if (tool === 'ref2va') {
    lines.push(
      'This is the reference-to-video tool. The user may attach reference images and videos; refer to them as ' +
      '"Image 1", "Image 2", "Video 1", etc., and describe how the subject/motion/background from each reference ' +
      'should drive the output. Reference structural example:'
    );
    lines.push(REF_STRUCTURE_EXAMPLE);
    if ((ak.Ref2vaExamples || '').trim()) {
      lines.push('User-provided reference examples and rules (follow these):');
      lines.push(ak.Ref2vaExamples.trim());
    }
  } else {
    lines.push(
      'This is the text/image-to-video tool. Attached images (optional) are the first and/or last frame — ' +
      'keep the described motion consistent with them.'
    );
    if ((ak.Fl2vaExamples || '').trim()) {
      lines.push('User-provided examples and rules (follow these):');
      lines.push(ak.Fl2vaExamples.trim());
    }
  }

  // Per-enabled-lora instruction blocks, authored by the user in Settings.
  for (const lora of LORAS) {
    if (!enabledLoras?.[lora.id]) continue;
    const instr = (ak[lora.instrKey] || '').trim();
    if (instr) {
      lines.push(`LoRA "${lora.label}" is ENABLED — apply its prompting rules (mandatory):`);
      lines.push(instr);
    }
  }

  const system = lines.join('\n\n');

  const userLines = [];
  if (prepend) userLines.push(prepend);
  userLines.push(description.trim());
  const user = userLines.join('\n\n');

  return { system, user };
}

// images: optional array of data URIs (image/*) for Grok vision. When present,
// Grok writes the prompt while looking at the attached materials.
export async function grokBuildPrompt({ tool, description, settings, enabledLoras, images }) {
  const ak = settings?.api_keys || {};
  const apiKey = (ak.Grok || '').trim();
  if (!apiKey) throw new Error('Не найден ключ Grok. Добавьте его в настройках.');
  let { system, user } = buildGrokMessages({ tool, description, settings, enabledLoras });
  const imgs = (images || []).filter((u) => typeof u === 'string' && u.startsWith('data:image'));
  if (imgs.length) {
    user += '\n\nThe attached image(s) are the materials to base the prompt on ' +
      '(reference them as Image 1, Image 2, … in the order given).';
  }
  const res = await invoke('grok_chat', {
    request: { system, user, api_key: apiKey, model: GROK_MODEL, images: imgs.length ? imgs : null },
  });
  return (res.content || '').trim();
}

// Max reference images the ref2va node exposes in the official template.
export const MAX_REF_IMAGES = 3;

// Assemble the ComfyUI API-format workflow. Images are referenced by filename
// via LoadImage; the bytes are uploaded through worker-comfyui's `input.images`
// channel (see runpodRunVideo).
//   fl2va: MiniMaxH3ImageToVideo + optional firstFrameName/lastFrameName.
//   ref2va: MiniMaxH3ReferenceToVideo + optional refImageNames[] (Image 1..N).
export function buildWorkflow({
  tool, unetFile, prompt, width, height, length, steps = 20, seed,
  firstFrameName, lastFrameName, refImageNames = [], loras = [],
}) {
  const wf = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: unetFile, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: CLIP, type: 'minimax', device: 'default' } },
    vaev: { class_type: 'VAELoader', inputs: { vae_name: VAE_VIDEO } },
    vaea: { class_type: 'VAELoader', inputs: { vae_name: VAE_AUDIO } },
  };

  // Stack LoRAs on the model path via our custom LoraFromURLModelOnly node.
  let modelRef = ['unet', 0];
  let li = 0;
  for (const l of loras) {
    const id = `lora_${li++}`;
    wf[id] = { class_type: 'LoraFromURLModelOnly', inputs: { model: modelRef, url: l.url, strength: l.strength } };
    modelRef = [id, 0];
  }

  // Load an image and center-crop-to-cover the target WxH so it isn't stretched
  // to the output aspect. Runs in the worker via the native ImageScale node
  // (crop: 'center' scales to cover, then crops the center to exactly W×H).
  const loadCropped = (nodeId, filename) => {
    const loadId = `${nodeId}_load`;
    wf[loadId] = { class_type: 'LoadImage', inputs: { image: filename } };
    wf[nodeId] = { class_type: 'ImageScale', inputs: { image: [loadId, 0], upscale_method: 'lanczos', width, height, crop: 'center' } };
    return [nodeId, 0];
  };

  if (tool === 'ref2va') {
    const refInputs = {
      clip: ['clip', 0], vae: ['vaev', 0], audio_vae: ['vaea', 0],
      prompt, width, height, length,
    };
    refImageNames.slice(0, MAX_REF_IMAGES).forEach((name, i) => {
      refInputs[`ref_image_${i}`] = loadCropped(`ref${i}`, name);
    });
    wf.h3 = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: refInputs };
  } else {
    const h3Inputs = { clip: ['clip', 0], vae: ['vaev', 0], prompt, width, height, length };
    if (firstFrameName) h3Inputs.first_frame = loadCropped('ff', firstFrameName);
    if (lastFrameName) h3Inputs.last_frame = loadCropped('lf', lastFrameName);
    wf.h3 = { class_type: 'MiniMaxH3ImageToVideo', inputs: h3Inputs };
  }

  wf.noise = { class_type: 'RandomNoise', inputs: { noise_seed: seed } };
  wf.guider = { class_type: 'BasicGuider', inputs: { model: modelRef, conditioning: ['h3', 0] } };
  wf.ksel = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } };
  wf.sched = { class_type: 'BasicScheduler', inputs: { model: modelRef, scheduler: 'simple', steps, denoise: 1.0 } };
  wf.samp = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['ksel', 0], sigmas: ['sched', 0], latent_image: ['h3', 1] } };
  wf.decv = { class_type: 'VAEDecode', inputs: { samples: ['samp', 0], vae: ['vaev', 0] } };
  wf.deca = { class_type: 'VAEDecodeAudio', inputs: { samples: ['samp', 0], vae: ['vaea', 0] } };
  wf.video = { class_type: 'CreateVideo', inputs: { images: ['decv', 0], audio: ['deca', 0], fps: FPS } };
  wf.save = { class_type: 'SaveVideo', inputs: { video: ['video', 0], filename_prefix: 'video/h3', format: 'auto', codec: 'auto' } };
  return wf;
}

function normalizeEndpoint(raw) {
  return (raw || '').trim().replace(/\/(run|runsync|status\/[^/]+)\/?$/, '').replace(/\/+$/, '');
}

// Submit a workflow to a RunPod serverless endpoint and poll until terminal.
// `images` is worker-comfyui's upload channel: [{name, image}] where image is
// bare base64 (no data: prefix); each name is referenced by a LoadImage node.
// onProgress(pct, statusText) is called as it advances. Returns base64 mp4.
export async function runpodRunVideo({ endpoint, apiKey, workflow, images, onProgress, signal }) {
  const base = normalizeEndpoint(endpoint);
  if (!base) throw new Error('Не задан эндпоинт RunPod для этого инструмента.');
  if (!apiKey) throw new Error('Не найден ключ RunPod. Добавьте его в настройках.');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  const input = { workflow };
  if (images && images.length) input.images = images;
  const runRes = await fetch(`${base}/run`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ input }),
  });
  if (!runRes.ok) throw new Error(`RunPod /run вернул HTTP ${runRes.status}: ${(await runRes.text()).slice(0, 300)}`);
  const runData = await runRes.json();
  const jobId = runData.id;
  if (!jobId) throw new Error('RunPod не вернул id задачи');
  onProgress?.(10, 'В очереди…');

  const deadline = Date.now() + 40 * 60_000; // generous for cold start + long clips
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Отменено');
    await new Promise((r) => setTimeout(r, 5000));
    const sRes = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, { headers, signal });
    if (!sRes.ok) throw new Error(`RunPod /status вернул HTTP ${sRes.status}`);
    const s = await sRes.json();
    if (s.status === 'IN_QUEUE') onProgress?.(15, 'В очереди (холодный старт воркера)…');
    else if (s.status === 'IN_PROGRESS') onProgress?.(60, 'Генерация…');
    else if (s.status === 'COMPLETED') {
      const out = s.output || {};
      const imgs = out.images || out.gifs || [];
      const item = Array.isArray(imgs) ? imgs[0] : null;
      const b64 = item?.data || (typeof out === 'string' ? out : null);
      if (!b64) throw new Error(`Задача завершена, но без видео: ${JSON.stringify(out).slice(0, 300)}`);
      onProgress?.(100, 'Готово');
      return b64;
    } else if (s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'TIMED_OUT') {
      throw new Error(`RunPod вернул ${s.status}: ${s.error || JSON.stringify(s.output || '').slice(0, 300)}`);
    }
  }
  throw new Error('RunPod: превышено время ожидания задачи');
}
