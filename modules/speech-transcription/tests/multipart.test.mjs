import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryOf, MultipartError, parseMultipart } from '../src/multipart.mjs';

const B = '----TOPEmatetestboundary1234567890';

function body(...sections) {
  return Buffer.from(`--${B}\r\n${sections.join(`\r\n--${B}\r\n`)}\r\n--${B}--\r\n`, 'utf8');
}

function field(name, value) {
  return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;
}

function file(name, filename, type, content) {
  return `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${content}`;
}

test('boundaryOf 解析带引号、不带引号与缺失的 boundary', () => {
  assert.equal(boundaryOf('multipart/form-data; boundary=abc123'), 'abc123');
  assert.equal(boundaryOf('multipart/form-data; boundary="abc 123"'), 'abc 123');
  assert.equal(boundaryOf('Multipart/Form-Data; charset=utf-8; boundary=xyz;'), 'xyz');
  assert.equal(boundaryOf('application/json'), null);
  assert.equal(boundaryOf(undefined), null);
  assert.equal(boundaryOf('multipart/form-data; boundary='), null);
});

test('parseMultipart 保留顺序，文本字段给 value、文件字段给 data', () => {
  const raw = body(field('meta', '{"stage":"speech"}'), file('audio', 'rec.webm', 'audio/webm', 'EBGDAudio-payload'));
  const { parts, truncated } = parseMultipart(raw, B);
  assert.equal(truncated, false);
  assert.deepEqual(parts.map(p => p.name), ['meta', 'audio']);
  assert.equal(parts[0].value, '{"stage":"speech"}');
  assert.equal(parts[0].data, undefined);
  assert.equal(parts[0].filename, null);
  assert.equal(parts[1].filename, 'rec.webm');
  assert.equal(parts[1].contentType, 'audio/webm');
  assert.equal(Buffer.isBuffer(parts[1].data), true);
  assert.equal(parts[1].value, undefined);
  assert.equal(parts[1].data.toString('utf8'), 'EBGDAudio-payload');
});

test('parseMultipart 按字节保留音频内容，不当作文本破坏', () => {
  const bytes = Buffer.from([0, 1, 2, 0x0d, 0x0a, 255, 254, 128, 0x2d, 0x2d]);
  const raw = Buffer.concat([
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`, 'utf8'),
    bytes,
    Buffer.from(`\r\n--${B}--\r\n`, 'utf8')
  ]);
  const { parts } = parseMultipart(raw, B);
  assert.deepEqual([...parts[0].data], [...bytes]);
});

test('parseMultipart 允许分界符前的空白前导', () => {
  const raw = Buffer.concat([Buffer.from('\r\n', 'utf8'), body(field('a', '1'))]);
  assert.equal(parseMultipart(raw, B).parts[0].value, '1');
});

test('parseMultipart 缺失结束分界符时标记 truncated', () => {
  const raw = Buffer.from(`--${B}\r\n${field('meta', 'x')}\r\n`, 'utf8');
  const { parts, truncated } = parseMultipart(raw, B);
  assert.equal(truncated, true);
  assert.equal(parts[0].value, 'x');
});

test('parseMultipart 拒绝非法负载', () => {
  assert.throws(() => parseMultipart('not a buffer', B), MultipartError);
  assert.throws(() => parseMultipart(Buffer.from('no boundary here'), B), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(Buffer.from('xx--' + B + '\r\n' + field('a', '1') + `\r\n--${B}--\r\n`), B), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(Buffer.from(`--${B}\r\nno headers\r\n--${B}--\r\n`), B), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(Buffer.from(`--${B}\r\nContent-Type: text/plain\r\n\r\nx\r\n--${B}--\r\n`), B), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(Buffer.from(`--${B}\r\nContent-Disposition: form-data\r\n\r\nx\r\n--${B}--\r\n`), B), { code: 'MALFORMED_MULTIPART' });
  assert.throws(() => parseMultipart(body(...Array.from({ length: 12 }, (_, i) => field(`f${i}`, '1'))), B, { maxParts: 4 }), { code: 'MALFORMED_MULTIPART' });
});
