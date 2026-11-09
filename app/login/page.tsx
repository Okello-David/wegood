import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <p className="text-6xl" aria-hidden="true">
          🛋️
        </p>
        <h1 className="mt-2 text-4xl font-bold">WeGood?</h1>
        <p className="mt-1 text-lg">Your roommates, at a glance.</p>
      </div>
      <LoginForm linkFailed={error === "link"} />
    </main>
  );
}
