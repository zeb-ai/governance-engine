"use client";

import { Copy, Eye, EyeOff, Key } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Group {
  group_id: string;
  name: string;
}

interface CreateKeyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  groups: Group[];
}

export function CreateKeyDrawer({
  open,
  onOpenChange,
  onSuccess,
  groups,
}: CreateKeyDrawerProps) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    group_id: "",
  });
  const [loading, setLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Auto-generate URLs from current domain
      const governanceUrl = window.location.origin;
      // For localhost/127.0.0.1, use direct port access
      // For production domains, use same domain as governance URL
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const otelEndpoint = isLocalhost
        ? `${window.location.protocol}//${window.location.hostname}:4318`
        : window.location.origin;

      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        group_id: formData.group_id,
        governance_url: governanceUrl,
        otel_endpoint: otelEndpoint,
      };

      const res = await fetch("/api/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to create key");
        return;
      }

      setGeneratedKey(data.key.encoded_key);
      setShowKey(true);
      toast.success("Configuration key created successfully!");
    } catch (err) {
      toast.error("Failed to create key");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedKey);
      toast.success("Key copied to clipboard!");
    } catch (err) {
      toast.error("Failed to copy key");
      console.error("Failed to copy:", err);
    }
  };

  const handleClose = () => {
    setFormData({
      name: "",
      description: "",
      group_id: "",
    });
    setGeneratedKey("");
    setShowKey(false);
    onOpenChange(false);
    if (generatedKey) {
      onSuccess();
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleClose} direction="right">
      <DrawerContent className="h-screen top-0 right-0 left-auto mt-0 w-175 rounded-none">
        <div className="flex flex-col h-full">
          <DrawerHeader className="text-left">
            <DrawerTitle>Create GRC Configuration Key</DrawerTitle>
            <DrawerDescription>
              Generate a new configuration key for GRC SDK integration
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-6">
            {!generatedKey ? (
              <form
                onSubmit={handleSubmit}
                id="create-key-form"
                className="space-y-6"
              >
                <div className="space-y-3">
                  <Label htmlFor="name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Production API Key"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    disabled={loading}
                    className="w-full border-2 border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Optional description for this key"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    disabled={loading}
                    rows={3}
                    className="w-full resize-none border-2 border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 bg-[#101e22]"
                  />
                </div>

                <div className="space-y-3">
                  <Label htmlFor="group">
                    Group <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.group_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, group_id: value })
                    }
                    required
                    disabled={loading}
                  >
                    <SelectTrigger className="w-full border-2 border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20">
                      <SelectValue placeholder="Select a group" />
                    </SelectTrigger>
                    <SelectContent className="w-full">
                      {groups.map((group) => (
                        <SelectItem
                          key={group.group_id}
                          value={group.group_id.toString()}
                        >
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Configuration URLs will be auto-generated from your domain
                  </p>
                </div>
              </form>
            ) : (
              <div className="space-y-6">
                <div className="bg-green-500/10 border-2 border-green-500/30 text-foreground p-4 rounded-lg">
                  <p className="font-semibold flex items-center gap-2">
                    <Key className="h-4 w-4 text-green-500" />
                    Key created successfully!
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Copy this key now. You won't be able to see it again.
                  </p>
                </div>

                <div className="space-y-3">
                  <Label>Configuration Key</Label>
                  <div className="flex gap-2">
                    <Input
                      value={generatedKey}
                      readOnly
                      type={showKey ? "text" : "password"}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DrawerFooter className="pt-4 border-t">
            {!generatedKey ? (
              <>
                <Button
                  type="submit"
                  form="create-key-form"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Creating..." : "Create Key"}
                </Button>
                <DrawerClose asChild>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </DrawerClose>
              </>
            ) : (
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
