import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import Workspace from './components/Workspace'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/post/:slug" element={<Workspace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
