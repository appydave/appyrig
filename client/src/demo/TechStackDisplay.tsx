interface TechItem {
  name: string;
  version: string;
  description: string;
}

interface TechCategory {
  title: string;
  items: TechItem[];
}

const techStack: TechCategory[] = [
  {
    title: 'Client',
    items: [
      { name: 'React', version: '19', description: 'UI component library' },
      { name: 'Vite', version: '7', description: 'Build tool & dev server' },
      { name: 'TailwindCSS', version: '4', description: 'Utility-first CSS framework' },
      { name: 'Socket.io Client', version: '4', description: 'Real-time WebSocket client' },
    ],
  },
  {
    title: 'Server',
    items: [
      { name: 'Express', version: '5', description: 'HTTP server framework' },
      { name: 'Socket.io', version: '4', description: 'Real-time WebSocket server' },
      { name: 'Pino', version: '9', description: 'High-performance JSON logger' },
      { name: 'Zod', version: '3', description: 'TypeScript-first schema validation' },
    ],
  },
  {
    title: 'Cross-cutting',
    items: [
      { name: 'TypeScript', version: '5', description: 'Type-safe JavaScript' },
      { name: 'ESLint', version: '9', description: 'Flat config linting' },
      { name: 'Prettier', version: '3', description: 'Code formatting' },
      { name: 'npm Workspaces', version: '-', description: 'Monorepo package management' },
    ],
  },
  {
    title: 'Testing & Quality',
    items: [
      { name: 'Vitest', version: '4', description: 'Unit & integration testing' },
      { name: 'Testing Library', version: '16', description: 'React component testing' },
      { name: 'Supertest', version: '7', description: 'HTTP assertion testing' },
      { name: 'Helmet', version: '8', description: 'Security headers middleware' },
    ],
  },
];

export default function TechStackDisplay() {
  return (
    <div data-testid="tech-stack">
      <h2 className="text-2xl font-bold mb-6 text-foreground">Tech Stack</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {techStack.map((category) => (
          <div key={category.title} className="rounded-xl p-5 bg-card border border-border">
            <h3 className="text-lg font-semibold mb-3 text-primary">{category.title}</h3>
            <ul className="space-y-2">
              {category.items.map((item) => (
                <li key={item.name}>
                  <span className="font-medium text-foreground">{item.name}</span>
                  {item.version !== '-' && (
                    <span className="text-xs ml-1 text-muted-foreground">v{item.version}</span>
                  )}
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
