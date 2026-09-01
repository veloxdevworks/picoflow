import { Cpu } from "lucide-react";

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <Cpu className="mb-4 h-10 w-10 text-cyan-400" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">PicoFlow</h1>
      <p className="mt-2 max-w-md text-center text-sm text-zinc-400">
        Photograph a device walkthrough, author a timed HID sequence, and flash
        it onto a Raspberry Pi Pico.
      </p>
    </main>
  );
}

export default App;
