import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Plan My Day</h1>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Welcome Section */}
          <Card>
            <CardHeader>
              <CardTitle>Welcome to Plan My Day</CardTitle>
              <CardDescription>
                Your personal day planning and task management app
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Get started by creating your first task or planning your day ahead.
              </p>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Add Task</CardTitle>
                <CardDescription>Create a new task</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">Add Task</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">View Calendar</CardTitle>
                <CardDescription>See your schedule</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">View Calendar</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Settings</CardTitle>
                <CardDescription>Manage preferences</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">Settings</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
