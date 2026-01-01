"use client";

import { Bell, Clock, Key, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { APIKeyManager } from "@/components/api-key-manager";
import { TimezoneSelector } from "@/components/timezone-selector";
import { PushNotificationManager } from "@/components/push-notification-manager";
import { PushSubscriptionList } from "@/components/push-subscription-list";
import { ForceUpdateButton } from "@/components/force-update-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Manage your account preferences and settings
          </p>
        </div>

        <Separator />

        {/* Timezone Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <CardTitle>Timezone Preferences</CardTitle>
            </div>
            <CardDescription>
              Set your preferred timezone. All dates and times will be displayed in this timezone,
              regardless of your local system time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimezoneSelector />
            <p className="text-sm text-muted-foreground mt-4">
              Changing your timezone will update how all dates and times are displayed throughout
              the application.
            </p>
          </CardContent>
        </Card>

        <Separator />

        {/* API Keys */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              <CardTitle>API Keys</CardTitle>
            </div>
            <CardDescription>
              Create and manage API keys to authenticate requests to the task import API. Use these
              keys to programmatically import tasks into your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <APIKeyManager />
          </CardContent>
        </Card>

        <Separator />

        {/* Push Notifications */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <CardTitle>Push Notifications</CardTitle>
            </div>
            <CardDescription>
              Enable push notifications to receive reminders for your tasks and important updates.
              You can test notifications and manage your subscription here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PushNotificationManager />
          </CardContent>
        </Card>

        <Separator />

        {/* Push Subscription List */}
        <PushSubscriptionList />

        <Separator />

        {/* App Updates */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              <CardTitle>App Updates</CardTitle>
            </div>
            <CardDescription>
              Manage app updates and check for new versions. Force update if a new version is
              available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForceUpdateButton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
