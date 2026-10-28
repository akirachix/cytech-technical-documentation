import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/cytech-technical-documentation/',

  title: 'AquaTrace',
  description: 'Technical documentation for the AquaTrace water quality monitoring platform',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Overview', link: '/overview/' },
      { text: 'Frontend', link: '/frontend/' },
      { text: 'Backend', link: '/backend/' },
      { text: 'IoT', link: '/iot/' },
      { text: 'Database & API', link: '/database/' },
      { text: 'WQI', link: '/wqi/' },
      { text: 'AI/RAG', link: '/ai/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'Security & Testing', link: '/security/' },
      { text: 'Deployment', link: '/deployment/' },
      { text: 'Developer Setup', link: '/dev/' }
    ],
    sidebar: [
      { text: 'Overview', items: [
        { text: 'System Overview', link: '/overview/' },
        { text: 'Architecture', link: '/overview/architecture' },
        { text: 'Data Flow', link: '/overview/data-flow' }
      ]},
      { text: 'Frontend', items: [
        { text: 'Frontend', link: '/frontend/' }
      ]},
      { text: 'Backend', items: [
        { text: 'Backend', link: '/backend/' }
      ]},
      { text: 'IoT', items: [
        { text: 'IoT Hardware & Sensors', link: '/iot/' }
      ]},
      { text: 'Database & API', items: [
        { text: 'Database & API Reference', link: '/database/' }
      ]},
      { text: 'WQI', items: [
        { text: 'WQI Calculation', link: '/wqi/' }
      ]},
      { text: 'AI/RAG', items: [
        { text: 'AI/RAG Assistant', link: '/ai/' }
      ]},
      { text: 'Operations', items: [
        { text: 'Alerts, Incidents, Maintenance, Lab Tests', link: '/operations/' }
      ]},
      { text: 'Security & Testing', items: [
        { text: 'Security & Testing', link: '/security/' }
      ]},
      { text: 'Deployment', items: [
        { text: 'Deployment', link: '/deployment/' }
      ]},
      { text: 'Developer Setup', items: [
        { text: 'Developer Setup', link: '/dev/' }
      ]}
    ]
  }
})