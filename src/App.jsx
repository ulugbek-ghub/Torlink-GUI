import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import SearchPage from './components/SearchPage.jsx'
import DownloadsPage from './components/DownloadsPage.jsx'
import SeedsPage from './components/SeedsPage.jsx'
import FilesPage from './components/FilesPage.jsx'
import SettingsPage from './components/SettingsPage.jsx'

const PAGES = [
  { id: 'search', label: 'Search', icon: '🔍' },
  { id: 'downloads', label: 'Downloads', icon: '⬇' },
  { id: 'seeds', label: 'Seeds', icon: '🌱' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export default function App() {
  const [page, setPage] = useState('search')
  const [searchTerm, setSearchTerm] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? '',
  )

  const renderPage = () => {
    switch (page) {
      case 'search':
        return <SearchPage initialTerm={searchTerm} onOpenDownloads={() => setPage('downloads')} />
      case 'downloads':
        return <DownloadsPage />
      case 'seeds':
        return <SeedsPage />
      case 'files':
        return <FilesPage />
      case 'settings':
        return <SettingsPage />
      default:
        return null
    }
  }

  return (
    <div className="app">
      <Sidebar
        pages={PAGES}
        active={page}
        onNavigate={(id) => {
          setPage(id)
          if (id === 'search') setSearchTerm('')
        }}
      />
      <main className="content">{renderPage()}</main>
    </div>
  )
}
