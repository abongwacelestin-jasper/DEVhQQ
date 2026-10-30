import { Toaster } from 'sonner';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={theme}
      toastOptions={{ style: { fontFamily: 'Inter, sans-serif', fontSize: 12.5 } }}
    />
  );
}
