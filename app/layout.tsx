import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

/**
 * IBM Plex rather than Inter or Geist. Both of those are fine typefaces that
 * have become the default look of generated software, and the brief here is
 * explicitly to not look like that. Plex reads technical and industrial, which
 * is the register a market wants.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Impact',
  description: 'A market for artists. Buy in before they blow up.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="topbar">
          <div className="shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <a href="/" className="wordmark">Impact</a>
            <nav className="nav">
              <a href="/" data-active="">Market</a>
              <a href="/portfolio">Portfolio</a>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}
