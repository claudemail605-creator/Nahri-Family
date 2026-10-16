import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';

import { mountApp } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element in index.html');
mountApp(root);
