/**
 * Генерирует временную метку в формате YYYYMMDDHHmm
 * @returns {string} Временная метка, например "202512191234"
 */
export function generateTimestamp() {
  const now = new Date();
  return now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
}
