// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, parseCSV } from './csv';

describe('sanitizeHtml', () => {
  it('allows whitelisted tags', () => {
    const html = '<b>bold</b> <i>italic</i> <u>underline</u>';
    const result = sanitizeHtml(html);

    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('<u>underline</u>');
  });

  it('allows strong and em tags', () => {
    const html = '<strong>strong</strong> <em>emphasis</em>';
    const result = sanitizeHtml(html);

    expect(result).toContain('<strong>strong</strong>');
    expect(result).toContain('<em>emphasis</em>');
  });

  it('allows list tags', () => {
    const html = '<ul><li>item 1</li><li>item 2</li></ul>';
    const result = sanitizeHtml(html);

    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
    expect(result).toContain('</ul>');
  });

  it('allows br and p tags', () => {
    const html = '<p>paragraph</p><br>line break';
    const result = sanitizeHtml(html);

    expect(result).toContain('<p>');
    expect(result).toContain('<br>');
  });

  it('allows image tags with safe media attributes', () => {
    const html = '<img src="https://example.com/cat.jpg" alt="cat" width="400" loading="lazy">';
    const result = sanitizeHtml(html);

    expect(result).toContain('<img');
    expect(result).toContain('src="https://example.com/cat.jpg"');
    expect(result).toContain('alt="cat"');
    expect(result).toContain('width="400"');
    expect(result).toContain('loading="lazy"');
  });

  it('allows audio tags and nested source tags', () => {
    const html = '<audio controls autoplay preload="none"><source src="https://example.com/audio.mp3" type="audio/mpeg"></audio>';
    const result = sanitizeHtml(html);

    expect(result).toContain('<audio');
    expect(result).toContain('controls');
    expect(result).toContain('autoplay');
    expect(result).toContain('<source');
    expect(result).toContain('src="https://example.com/audio.mp3"');
    expect(result).toContain('type="audio/mpeg"');
  });

  it('strips dangerous script tags', () => {
    const html = '<script>alert("xss")</script>Hello';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Hello');
  });

  it('strips iframe tags', () => {
    const html = '<iframe src="https://evil.com"></iframe>Content';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('evil.com');
    expect(result).toContain('Content');
  });

  it('strips object tags', () => {
    const html = '<object data="malware.swf"></object>Safe content';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('<object');
    expect(result).not.toContain('malware.swf');
    expect(result).toContain('Safe content');
  });

  it('allows whitelisted styles', () => {
    const html = '<span style="color: red; font-size: 14px;">styled</span>';
    const result = sanitizeHtml(html);

    expect(result).toContain('color');
    expect(result).toContain('font-size');
  });

  it('strips disallowed styles', () => {
    const html = '<span style="position: absolute; display: none; color: red;">styled</span>';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('position');
    expect(result).not.toContain('display');
    expect(result).toContain('color');
  });

  it('handles empty input', () => {
    const result = sanitizeHtml('');
    expect(result).toBe('');
  });

  it('preserves text content', () => {
    const html = 'Plain text with <b>some</b> formatting';
    const result = sanitizeHtml(html);

    expect(result).toContain('Plain text with');
    expect(result).toContain('some');
    expect(result).toContain('formatting');
  });

  it('strips event handlers', () => {
    const html = '<span onclick="alert(1)">click me</span>';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('onclick');
    expect(result).toContain('click me');
  });

  it('strips dangerous media attributes and javascript URLs', () => {
    const html = '<img src="javascript:alert(1)" onerror="alert(1)" alt="x">';
    const result = sanitizeHtml(html);

    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('onerror');
    expect(result).toContain('<img');
    expect(result).toContain('alt="x"');
  });
});

describe('parseCSV', () => {
  it('parses valid CSV with front/back columns', () => {
    const csv = `front,back
Question 1,Answer 1
Question 2,Answer 2`;

    const result = parseCSV(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toEqual({ front: 'Question 1', back: 'Answer 1' });
    expect(result.cards[1]).toEqual({ front: 'Question 2', back: 'Answer 2' });
  });

  it('returns error for missing front column data', () => {
    const csv = `front,back
,Answer 1`;

    const result = parseCSV(csv);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Missing');
  });

  it('returns error for missing back column data', () => {
    const csv = `front,back
Question 1,`;

    const result = parseCSV(csv);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Missing');
  });

  it('handles empty rows (skips them)', () => {
    const csv = `front,back
Question 1,Answer 1

Question 2,Answer 2`;

    const result = parseCSV(csv);

    expect(result.cards).toHaveLength(2);
  });

  it('sanitizes HTML in card content', () => {
    const csv = `front,back
<script>alert(1)</script>Question,<b>Answer</b><script>bad</script>`;

    const result = parseCSV(csv);

    expect(result.cards[0].front).not.toContain('<script>');
    expect(result.cards[0].front).toContain('Question');
    expect(result.cards[0].back).not.toContain('<script>');
    expect(result.cards[0].back).toContain('<b>Answer</b>');
  });

  it('header matching is case-insensitive', () => {
    const csv = `FRONT,BACK
Question 1,Answer 1`;

    const result = parseCSV(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toEqual({ front: 'Question 1', back: 'Answer 1' });
  });

  it('handles quoted values with commas', () => {
    const csv = `front,back
"Question, with comma","Answer, also with comma"`;

    const result = parseCSV(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].front).toBe('Question, with comma');
    expect(result.cards[0].back).toBe('Answer, also with comma');
  });

  it('trims whitespace from content', () => {
    const csv = `front,back
  Question with spaces  ,  Answer with spaces  `;

    const result = parseCSV(csv);

    expect(result.cards[0].front).toBe('Question with spaces');
    expect(result.cards[0].back).toBe('Answer with spaces');
  });

  it('preserves allowed HTML formatting', () => {
    const csv = `front,back
<b>Bold question</b>,<i>Italic answer</i>`;

    const result = parseCSV(csv);

    expect(result.cards[0].front).toContain('<b>');
    expect(result.cards[0].back).toContain('<i>');
  });

  it('preserves allowed image and audio HTML', () => {
    const csv = `front,back
"<img src=""https://example.com/pic.jpg"" alt=""Picture"" loading=""lazy"">","<audio controls src=""https://example.com/clip.mp3""></audio>"`;

    const result = parseCSV(csv);

    expect(result.errors).toHaveLength(0);
    expect(result.cards[0].front).toContain('<img');
    expect(result.cards[0].front).toContain('src="https://example.com/pic.jpg"');
    expect(result.cards[0].back).toContain('<audio');
    expect(result.cards[0].back).toContain('src="https://example.com/clip.mp3"');
  });
});
