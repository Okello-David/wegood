import BottomTabs from "@/components/nav/BottomTabs";

// A route group: the (app) folder adds the tab bar to every in-room screen
// without adding "/app" to the URLs. Login and onboarding stay outside it.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {children}
      <BottomTabs />
    </>
  );
}
