export interface AddServerSaveData {
  name: string;
  urls: string[];
  username: string;
  password: string;
}

export interface AddServerSheetProps {
  visible: boolean;
  title?: string;
  initialData?: AddServerSaveData;
  embeddedInHost?: boolean;
  onClose: () => void;
  onSave: (data: AddServerSaveData) => void;
}
