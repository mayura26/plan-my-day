"use client";

import {
  AlertTriangle,
  CheckCircle,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PushSubscription {
  id: string;
  endpoint: string;
  deviceName: string;
  userAgent: string;
  lastSeen: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PushSubscriptionListProps {
  className?: string;
}

export function PushSubscriptionList({ className }: PushSubscriptionListProps) {
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);

  // Check if we're in development mode
  const isDevelopment =
    typeof window !== "undefined" &&
    (process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const fetchSubscriptions = useCallback(async () => {
    try {
      const response = await fetch("/api/push/subscriptions");
      if (response.ok) {
        const data = await response.json();
        setSubscriptions(data.subscriptions || []);
      } else {
        toast.error("Failed to fetch subscriptions");
      }
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      toast.error("Failed to fetch subscriptions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removeSubscription = async (subscriptionId: string) => {
    try {
      const response = await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriptionId }),
      });

      if (response.ok) {
        toast.success("Subscription removed successfully");
        await fetchSubscriptions();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to remove subscription");
      }
    } catch (error) {
      console.error("Error removing subscription:", error);
      toast.error("Failed to remove subscription");
    }
  };

  const cleanupSubscriptions = async () => {
    setIsCleaning(true);
    try {
      const response = await fetch("/api/push/cleanup", {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(
          `Cleanup completed: ${data.removedSubscriptions} invalid subscriptions removed`
        );
        await fetchSubscriptions();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to cleanup subscriptions");
      }
    } catch (error) {
      console.error("Error cleaning up subscriptions:", error);
      toast.error("Failed to cleanup subscriptions");
    } finally {
      setIsCleaning(false);
    }
  };

  const getDeviceIcon = (deviceName: string) => {
    if (deviceName.toLowerCase().includes("mobile")) {
      return <Smartphone className="w-4 h-4" />;
    } else if (deviceName.toLowerCase().includes("tablet")) {
      return <Tablet className="w-4 h-4" />;
    } else {
      return <Monitor className="w-4 h-4" />;
    }
  };

  const getStatusIcon = (isActive: boolean, lastSeen: string) => {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const daysSinceLastSeen = Math.floor(
      (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (!isActive) {
      return <XCircle className="w-4 h-4 text-destructive" />;
    } else if (daysSinceLastSeen > 7) {
      return <WifiOff className="w-4 h-4 text-yellow-500" />;
    } else {
      return <Wifi className="w-4 h-4 text-green-500" />;
    }
  };

  const getStatusText = (isActive: boolean, lastSeen: string) => {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const daysSinceLastSeen = Math.floor(
      (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (!isActive) {
      return "Inactive";
    } else if (daysSinceLastSeen > 7) {
      return "Inactive (7+ days)";
    } else if (daysSinceLastSeen > 1) {
      return `Active (${daysSinceLastSeen} days ago)`;
    } else {
      return "Active (Recent)";
    }
  };

  const getStatusColor = (isActive: boolean, lastSeen: string) => {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const daysSinceLastSeen = Math.floor(
      (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (!isActive) {
      return "destructive";
    } else if (daysSinceLastSeen > 7) {
      return "secondary";
    } else {
      return "default";
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // Show message in development that this requires production
  if (isDevelopment) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Push Subscriptions
          </CardTitle>
          <CardDescription>
            Manage your push notification subscriptions across devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-muted p-4 text-sm">
            <p className="font-medium mb-2">Push Subscriptions</p>
            <p className="text-muted-foreground">
              Push subscription management requires service workers, which are disabled in
              development mode. Build and run in production mode to manage subscriptions.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Push Subscriptions
          </CardTitle>
          <CardDescription>
            Manage your push notification subscriptions across devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Push Subscriptions
        </CardTitle>
        <CardDescription>
          Manage your push notification subscriptions across devices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {subscriptions.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No push subscriptions found. Enable notifications to create your first subscription.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {subscriptions.length} device
                {subscriptions.length !== 1 ? "s" : ""} registered
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchSubscriptions}
                  disabled={isLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cleanupSubscriptions}
                  loading={isCleaning}
                >
                  {!isCleaning && <CheckCircle className="w-4 h-4" />}
                  Cleanup
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {subscriptions.map((subscription) => (
                <div
                  key={subscription.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getDeviceIcon(subscription.deviceName)}
                    <div>
                      <p className="font-medium">{subscription.deviceName}</p>
                      <p className="text-sm text-muted-foreground">
                        {subscription.userAgent.split(" ")[0]} •{" "}
                        {new Date(subscription.lastSeen).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={getStatusColor(subscription.isActive, subscription.lastSeen)}>
                      {getStatusIcon(subscription.isActive, subscription.lastSeen)}
                      <span className="ml-1">
                        {getStatusText(subscription.isActive, subscription.lastSeen)}
                      </span>
                    </Badge>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeSubscription(subscription.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
