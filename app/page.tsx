"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect authenticated users to calendar (main dashboard)
  useEffect(() => {
    if (status === "authenticated") {
      router.push("/calendar");
    }
  }, [status, router]);

  // Show loading while checking auth or redirecting
  if (status === "loading" || session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl md:text-2xl font-bold">Plan My Day</h1>
          <div className="flex items-center space-x-2 md:space-x-4">
            <AuthButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content - Marketing Page for Non-Authenticated Users */}
      <main className="container mx-auto px-4 py-6 md:py-8">
        <div className="max-w-6xl mx-auto space-y-12 md:space-y-16">
          {/* Hero Section */}
          <div className="text-center space-y-4 md:space-y-6">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
              Plan Your Day with
              <span className="text-primary"> AI-Powered</span> Scheduling
            </h1>
            <p className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto px-4">
              Transform your productivity with intelligent task management, smart scheduling, and
              seamless calendar integration.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center px-4">
              <Link href="/api/auth/signin">
                <Button size="lg" className="w-full sm:w-auto h-12 px-6">
                  Get Started Free
                </Button>
              </Link>
              <Button variant="outline" size="lg" className="w-full sm:w-auto h-12 px-6">
                Learn More
              </Button>
            </div>
          </div>

          {/* Features Section */}
          <div className="space-y-8 md:space-y-12">
            <h2 className="text-2xl md:text-3xl font-bold text-center px-4">
              Why Choose Plan My Day?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 px-4">
              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">🧠</div>
                <h3 className="text-xl font-semibold mb-2">Smart Task Management</h3>
                <p className="text-muted-foreground">
                  Create, organize, and prioritize tasks with intelligent categorization and
                  deadline tracking.
                </p>
              </Card>

              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">🤖</div>
                <h3 className="text-xl font-semibold mb-2">AI-Powered Scheduling</h3>
                <p className="text-muted-foreground">
                  Let artificial intelligence optimize your schedule based on energy levels,
                  priorities, and deadlines.
                </p>
              </Card>

              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">📅</div>
                <h3 className="text-xl font-semibold mb-2">Calendar Integration</h3>
                <p className="text-muted-foreground">
                  Seamlessly sync with Google Calendar to see tasks alongside your events and
                  meetings.
                </p>
              </Card>

              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">👥</div>
                <h3 className="text-xl font-semibold mb-2">Team Collaboration</h3>
                <p className="text-muted-foreground">
                  Work together with your team on shared projects and track collective progress.
                </p>
              </Card>

              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">⚡</div>
                <h3 className="text-xl font-semibold mb-2">Energy-Based Planning</h3>
                <p className="text-muted-foreground">
                  Schedule tasks based on your energy levels throughout the day for maximum
                  productivity.
                </p>
              </Card>

              <Card className="text-center p-6 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">📱</div>
                <h3 className="text-xl font-semibold mb-2">Cross-Platform</h3>
                <p className="text-muted-foreground">
                  Access your tasks anywhere with our responsive web app and upcoming mobile
                  applications.
                </p>
              </Card>
            </div>
          </div>

          {/* CTA Section */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="text-center py-8 md:py-12 px-4">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Ready to Transform Your Productivity?
              </h2>
              <p className="text-base md:text-lg lg:text-xl text-muted-foreground mb-6 md:mb-8">
                Join thousands of users who are already planning their days more effectively.
              </p>
              <Link href="/api/auth/signin">
                <Button size="lg" className="text-base md:text-lg px-6 md:px-8 h-12 md:h-14">
                  Start Planning Today
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
