export interface AddServerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave?: (data: {
    name: string;
    url: string;
    username: string;
    password: string;
  }) => void;
}
