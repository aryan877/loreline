import { Logo } from "@/components/brand/logo";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 sm:py-20">
      <Logo />
      <article className="mt-16">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-coral">
          Privacy principles
        </p>
        <h1 className="mt-4 font-display text-6xl tracking-[-0.05em]">
          Your library is yours.
        </h1>
        <div className="mt-10 space-y-7 text-pretty leading-relaxed text-muted-foreground">
          <p>
            Loreline stores each PDF under an account-scoped object key and
            checks ownership before every read, retrieval, chat, or illustration
            request.
          </p>
          <p>
            Your OpenAI key remains on the server. Voice sessions use a
            short-lived client secret, never the long-lived API key. Book
            context is shared with the model only when you actively use an AI
            feature.
          </p>
          <p>
            Generated explanations and images are grounded in the page you are
            viewing. Semantic retrieval from the rest of the book is secondary
            and invoked when the visible context is insufficient.
          </p>
          <p>
            This repository is an end-to-end product foundation. Before public
            launch, add your final legal terms, retention window, data-export
            flow, and account deletion workflow.
          </p>
        </div>
      </article>
    </main>
  );
}
