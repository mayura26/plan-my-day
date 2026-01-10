"use client";

import { Github, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { getProviders, getSession, signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Helper function to get server version
async function getServerVersion(): Promise<string> {
  try {
    const response = await fetch("/api/version");
    if (response.ok) {
      const data = await response.json();
      return data.version || "1";
    }
  } catch (error) {
    console.error("Error fetching server version:", error);
  }
  return "1";
}

export default function SignIn() {
  const [providers, setProviders] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      const res = await getProviders();
      setProviders(res);
      setIsLoading(false);
    };

    fetchProviders();
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      const session = await getSession();
      if (session) {
        router.push("/");
      }
    };
    checkSession();
  }, [router]);

  // Fetch version on mount
  useEffect(() => {
    const fetchVersion = async () => {
      const v = await getServerVersion();
      setVersion(v);
    };
    fetchVersion();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
          {version && (
            <p className="text-xs text-muted-foreground/70 mt-2">v{version}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Plan My Day</CardTitle>
          <CardDescription>Sign in to access your task management dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers &&
            Object.values(providers).map((provider: any) => (
              <div key={provider.name}>
                <Button
                  onClick={() => signIn(provider.id, { callbackUrl: "/" })}
                  className="w-full"
                  variant={provider.name === "Google" ? "default" : "outline"}
                >
                  {provider.name === "Google" ? (
                    <>
                      <Mail className="w-4 h-4 mr-2" />
                      Continue with Google
                    </>
                  ) : (
                    <>
                      <Github className="w-4 h-4 mr-2" />
                      Continue with GitHub
                    </>
                  )}
                </Button>
              </div>
            ))}

          <div className="text-center text-sm text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
