import { themeIcons } from 'seti-icons';

const getIcon = themeIcons({
  blue: '#6ab0f3',
  grey: '#98a4a8',
  'grey-light': '#a6b5ba',
  green: '#a5d06c',
  orange: '#e8965a',
  pink: '#f78caa',
  purple: '#b294c7',
  red: '#e06c75',
  white: '#d4d7d6',
  yellow: '#e5c07b',
  ignore: '#6b7d84',
});

export function getFileIcon(filename: string): { svg: string; color: string } {
  return getIcon(filename);
}
