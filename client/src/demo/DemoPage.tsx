/**
 * TEMPLATE DEMO PAGE — delete this file and its references when you start building your app.
 * Shows all AppyStack template features working together.
 */

import { useState } from 'react';
import ContactForm from './ContactForm.js';
import SocketDemo from './SocketDemo.js';
import StatusGrid from './StatusGrid.js';
import TechStackDisplay from './TechStackDisplay.js';

export default function DemoPage() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="border-t border-border">
      <div className="max-w-5xl mx-auto px-6 py-4">
        <p className="text-xs font-mono text-primary/70 uppercase tracking-widest">
          Template Demo — delete when building your app
        </p>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        <section>
          <h2 className="text-2xl font-bold mb-6 text-foreground">System Status</h2>
          <StatusGrid />
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-6 text-foreground">Socket.io</h2>
          <SocketDemo />
        </section>

        <section>
          <TechStackDisplay />
        </section>

        <section>
          <button
            onClick={() => setShowForm((prev) => !prev)}
            className="text-sm font-medium px-4 py-2 rounded transition-colors bg-card border border-border text-muted-foreground"
          >
            {showForm ? 'Hide example form' : 'Show example form'}
          </button>

          {showForm && (
            <div className="mt-4 rounded-xl p-6 bg-card border border-border">
              <h2 className="text-lg font-semibold mb-4 text-foreground">React Hook Form + Zod</h2>
              <ContactForm />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
