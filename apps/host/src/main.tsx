import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HostApp } from '../../../packages/editor-react/src/HostApp.js'
import './host.css'

const root = document.getElementById('root')
if (!root) throw new Error('PPTE_HOST_ROOT_MISSING')
createRoot(root).render(<StrictMode><HostApp /></StrictMode>)
