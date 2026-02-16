"use client";

import { Calendar, CheckSquare, Menu, Settings, Tag, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Calendar", href: "/calendar", icon: Calendar },
  { name: "Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Tags", href: "/tags", icon: Tag },
  { name: "Settings", href: "/settings", icon: Settings },
];

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

export function Navigation() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  // Fetch version on mount
  useEffect(() => {
    const fetchVersion = async () => {
      const v = await getServerVersion();
      setVersion(v);
    };
    fetchVersion();
  }, []);

  if (!session) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 shadow-sm">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <Link
              href="/calendar"
              className="flex items-center gap-3 group transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="relative h-9 w-9 rounded-xl overflow-hidden ring-1 ring-border/50 group-hover:ring-primary/20 transition-all duration-200 shadow-sm">
                <Image
                  src="/icon.png"
                  alt="Plan My Day"
                  fill
                  className="object-cover"
                  sizes="36px"
                  priority
                />
              </div>
              <span className="font-bold text-xl bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                Plan My Day
                {version && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">v{version}</span>
                )}
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1.5">
            {navigation.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                    "before:absolute before:inset-0 before:rounded-lg before:transition-all before:duration-200",
                    isActive
                      ? "text-primary-foreground before:bg-primary before:shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:before:bg-accent/50 before:opacity-0 hover:before:opacity-100"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 relative z-10 transition-transform duration-200",
                      isActive && "scale-110"
                    )}
                  />
                  <span className="relative z-10">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden sm:block">
              <AuthButton />
            </div>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden relative"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <div className="relative w-5 h-5">
                <Menu
                  className={cn(
                    "absolute inset-0 h-5 w-5 transition-all duration-200",
                    isMobileMenuOpen
                      ? "opacity-0 rotate-90 scale-0"
                      : "opacity-100 rotate-0 scale-100"
                  )}
                />
                <X
                  className={cn(
                    "absolute inset-0 h-5 w-5 transition-all duration-200",
                    isMobileMenuOpen
                      ? "opacity-100 rotate-0 scale-100"
                      : "opacity-0 -rotate-90 scale-0"
                  )}
                />
              </div>
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div
          className={cn(
            "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
            isMobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="border-t border-border/40 pt-2 pb-4">
            <nav className="space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200",
                      "relative overflow-hidden group",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50 active:bg-accent"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 transition-transform duration-200",
                        isActive && "scale-110"
                      )}
                    />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
              {/* Show auth button in mobile menu */}
              <div className="px-4 pt-2 border-t border-border/40 mt-2 sm:hidden">
                <div className="py-2">
                  <AuthButton />
                </div>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
