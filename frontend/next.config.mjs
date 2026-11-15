// Политика одна на весь продукт: та же строка стоит в Traefik-middleware чарта
// (k8s/helm/retro-board/templates/traefik.yaml), совпадение проверяет
// scripts/helm-render-checks.sh. Соединения — только на свой хост: 'self'
// покрывает и WebSocket того же origin.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"

// Локальная разработка без прокси: WebSocket идёт на бэкенд мимо Next,
// его хост (NEXT_PUBLIC_WS_HOST) разрешается явно.
const wsHost = process.env.NEXT_PUBLIC_WS_HOST
const contentSecurityPolicy = wsHost
  ? CSP.replace("connect-src 'self'", `connect-src 'self' ws://${wsHost} wss://${wsHost}`)
  : CSP

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
]

const nextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_URL) {
      return []
    }
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
