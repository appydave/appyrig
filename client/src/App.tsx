import DemoPage from './demo/DemoPage.js';
import LandingPage from './pages/LandingPage.js';

export default function App() {
  return (
    <>
      <LandingPage />
      {import.meta.env.DEV && <DemoPage />}
    </>
  );
}
