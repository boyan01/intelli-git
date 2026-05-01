interface FileIcon {
  svg: string;
  color: string;
}

const FILE_COLORS: Record<string, string> = {
  ts: '#519aba',
  tsx: '#519aba',
  js: '#cbcb41',
  jsx: '#cbcb41',
  json: '#f0db4f',
  css: '#42a5f5',
  scss: '#f06292',
  html: '#e37933',
  md: '#519aba',
  svg: '#d4a93d',
  png: '#a074c4',
  jpg: '#a074c4',
  jpeg: '#a074c4',
  gif: '#a074c4',
  lock: '#6b7d84'
};

const DEFAULT_COLOR = '#98a4a8';

const fileSvg = `
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2.5h5L12 5.5v8H4v-11Z" fill="currentColor" fill-opacity="0.18"/>
  <path d="M9 2.5v3h3" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M4 2.5h5L12 5.5v8H4v-11Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

export function getFileIcon(filename: string): FileIcon {
  const normalized = filename.toLowerCase();
  const extension = normalized.endsWith('package-lock.json')
    ? 'lock'
    : normalized.split('.').pop() || '';

  return {
    svg: fileSvg,
    color: FILE_COLORS[extension] || DEFAULT_COLOR
  };
}
