export class MultipartError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MultipartError';
    this.code = code;
  }
}

const CR = 0x0d, LF = 0x0a, DASH = 0x2d;

/** Pull `name` and optional `filename` out of a Content-Disposition value. */
function contentDispositionParams(value) {
  const out = { name: null, filename: null };
  for (const piece of value.split(';').slice(1)) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    let val = piece.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    if (key === 'name') out.name = val;
    else if (key === 'filename') out.filename = val;
  }
  return out;
}

/**
 * Parse a complete `multipart/form-data` payload that has already been read into
 * a buffer (the service caps body size before calling this).
 *
 * Part ordering is preserved. Text parts expose `value` (utf8), file parts expose
 * `data` (Buffer) plus `filename` and `contentType`.
 *
 * Boundary bytes could in principle occur inside binary audio; every delimiter we
 * match is a full `\r\n--<boundary>` line, and browsers generate a 32+ character
 * random boundary, so the collision probability is negligible for a loopback service.
 */
export function parseMultipart(raw, boundary, { maxParts = 8 } = {}) {
  if (!Buffer.isBuffer(raw)) throw new MultipartError('MALFORMED_MULTIPART', '负载不是缓冲区。');
  if (typeof boundary !== 'string' || !boundary) throw new MultipartError('MALFORMED_MULTIPART', '缺少 multipart 分界符。');
  const open = Buffer.from(`--${boundary}`, 'latin1');
  const sep = Buffer.from(`\r\n--${boundary}`, 'latin1');

  let cursor = raw.indexOf(open);
  if (cursor < 0) throw new MultipartError('MALFORMED_MULTIPART', '负载里没有 multipart 分界符。');
  /* Tolerate a preamble before the first delimiter, but only whitespace/CRLF. */
  for (let i = 0; i < cursor; i++) {
    if (raw[i] !== CR && raw[i] !== LF) throw new MultipartError('MALFORMED_MULTIPART', '第一个分界符之前有非法内容。');
  }
  cursor += open.length;

  const parts = [];
  while (cursor + 1 < raw.length) {
    if (raw[cursor] === DASH && raw[cursor + 1] === DASH) return { parts, truncated: false };
    if (raw[cursor] !== CR || raw[cursor + 1] !== LF) throw new MultipartError('MALFORMED_MULTIPART', '分界符后面缺少换行。');
    cursor += 2;

    const next = raw.indexOf(sep, cursor);
    if (next < 0) {
      /* Last part ran to the end of the body without a closing delimiter. */
      parts.push(parsePart(raw.subarray(cursor), parts.length));
      return { parts, truncated: true };
    }
    parts.push(parsePart(raw.subarray(cursor, next), parts.length));
    cursor = next + sep.length;
    if (parts.length > maxParts) throw new MultipartError('MALFORMED_MULTIPART', '表单字段数量超出限制。');
  }
  throw new MultipartError('MALFORMED_MULTIPART', 'multipart 负载在结束分界符之前就被截断了。');
}

function parsePart(section, index) {
  const separatorIndex = section.indexOf('\r\n\r\n');
  if (separatorIndex < 0) throw new MultipartError('MALFORMED_MULTIPART', `第 ${index + 1} 个表单字段缺少头部。`);
  const headerText = section.subarray(0, separatorIndex).toString('utf8');
  let body = section.subarray(separatorIndex + 4);
  /* A part's body is followed by the CRLF that belongs to the next delimiter. */
  if (body.length >= 2 && body[body.length - 2] === CR && body[body.length - 1] === LF) body = body.subarray(0, body.length - 2);

  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const eq = line.indexOf(':');
    if (eq < 0) continue;
    headers[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  const disposition = headers['content-disposition'];
  if (!disposition || !disposition.toLowerCase().startsWith('form-data')) {
    throw new MultipartError('MALFORMED_MULTIPART', `第 ${index + 1} 个表单字段没有 form-data 声明。`);
  }
  const { name, filename } = contentDispositionParams(disposition);
  if (!name) throw new MultipartError('MALFORMED_MULTIPART', `第 ${index + 1} 个表单字段没有 name。`);
  const part = { name, filename: filename ?? null, contentType: headers['content-type'] || '' };
  if (filename === null && !headers['content-type']) {
    part.value = body.toString('utf8');
  } else if (filename === null) {
    /* A named field that still carries a content type (browsers do this for Blob fields). */
    part.value = body.toString('utf8');
    part.data = body;
  } else {
    part.data = body;
  }
  return part;
}

/** Boundary token of a `multipart/form-data; boundary=...` header value. */
export function boundaryOf(contentType) {
  if (typeof contentType !== 'string') return null;
  const match = /(?:^|;)\s*boundary=(?:"([^"]*)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim() || null;
}
