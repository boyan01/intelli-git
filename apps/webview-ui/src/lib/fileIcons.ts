import definitions from '../assets/seti-icons/definitions.json';
import icons from '../assets/seti-icons/icons.json';

interface FileIcon {
  svg: string;
  color: string;
}

type SetiColor =
  | 'blue'
  | 'grey'
  | 'grey-light'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'white'
  | 'yellow'
  | 'ignore';

type IconDetails = [iconName: string, color: SetiColor];

type SetiDefinitions = {
  files: Record<string, IconDetails>;
  extensions: Record<string, IconDetails>;
  partials: Array<[partial: string, details: IconDetails]>;
  default: IconDetails;
};

const setiDefinitions = definitions as unknown as SetiDefinitions;
const setiIcons = icons as Record<string, string>;

const SETI_THEME: Record<SetiColor, string> = {
  blue: '#519aba',
  grey: '#4d5a5e',
  'grey-light': '#6b7d84',
  green: '#8dc149',
  orange: '#e37933',
  pink: '#f06292',
  purple: '#a074c4',
  red: '#cc3e44',
  white: '#d4d7d6',
  yellow: '#cbcb41',
  ignore: '#41535b'
};

function getIconDetails(filename: string): IconDetails {
  const fileDetails = setiDefinitions.files[filename];
  if (fileDetails) {
    return fileDetails;
  }

  let extension = filename.slice(filename.indexOf('.'));
  while (extension !== '') {
    const extensionDetails = setiDefinitions.extensions[extension];
    if (extensionDetails) {
      return extensionDetails;
    }

    extension = extension.slice(1);
    extension = extension.slice(extension.indexOf('.'));
  }

  const partialDetails = setiDefinitions.partials.find(([partial]) => filename.includes(partial));
  return partialDetails?.[1] || setiDefinitions.default;
}

export function getFileIcon(filename: string): FileIcon {
  const [iconName, color] = getIconDetails(filename.toLowerCase());

  return {
    svg: setiIcons[iconName] || setiIcons[setiDefinitions.default[0]] || '',
    color: SETI_THEME[color]
  };
}
