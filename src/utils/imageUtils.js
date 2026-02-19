/**
 * Уменьшает изображение так, чтобы общее число пикселей не превышало maxPixels.
 * Сохраняет пропорции. Возвращает новый File (PNG) или исходный file, если уменьшение не нужно.
 * @param {File} file
 * @param {number} maxPixels
 * @returns {Promise<File>}
 */
export function resizeImageFileToMaxPixels(file, maxPixels = 4194304) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const area = w * h;
      if (area <= maxPixels) {
        resolve(file);
        return;
      }
      const scale = Math.sqrt(maxPixels / area);
      const nw = Math.max(1, Math.round(w * scale));
      const nh = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2d not available'));
        return;
      }
      ctx.drawImage(img, 0, 0, nw, nh);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, '') || 'image';
          resolve(new File([blob], `${name}.png`, { type: 'image/png' }));
        },
        'image/png',
        0.95
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
