// TODO: Replace this placeholder content with your app

const ASCII_BANNER = `     _                      ____  _             _
    / \\   _ __  _ __  _   _/ ___|| |_ __ _  ___| | __
   / _ \\ | '_ \\| '_ \\| | | \\___ \\| __/ _\` |/ __| |/ /
  / ___ \\| |_) | |_) | |_| |___) | || (_| | (__|   <
 /_/   \\_\\ .__/| .__/ \\__, |____/ \\__\\__,_|\\___|_|\\_\\
         |_|   |_|    |___/`;

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="py-16 text-center bg-background">
        <pre className="inline-block text-left text-sm md:text-base leading-tight text-primary font-mono">
          {ASCII_BANNER}
        </pre>
        <p className="mt-4 text-lg text-primary/70 font-mono">
          Production-ready RVETS stack boilerplate
        </p>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* TODO: Add your app content here */}
        <p className="text-muted-foreground text-center">
          Your app content goes here. See <code>src/demo/DemoPage.tsx</code> for feature examples.
        </p>
      </main>
    </div>
  );
}
