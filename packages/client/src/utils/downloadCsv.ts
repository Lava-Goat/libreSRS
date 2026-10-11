// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
export function downloadCsv(csv: string, filename: string) {
  // BOM so Excel opens UTF-8 (accented names/words) correctly.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // The anchor must be in the document for the click to trigger a download in
  // some browsers, and revoking the URL synchronously can abort the download —
  // defer both cleanups a tick.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
