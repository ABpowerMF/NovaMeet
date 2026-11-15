import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './base.css';
import './app.css';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);
