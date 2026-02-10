import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import ProjectProvider from './components/ProjectProvider'

export default function App() {
  return (
    <BrowserRouter>
      <ProjectProvider>
        <Routes>
          <Route path="/*" element={<Shell />} />
        </Routes>
      </ProjectProvider>
    </BrowserRouter>
  )
}
