"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Library, LogOut } from "lucide-react";
import type { CurrentUser } from "@loreline/contracts/auth";
import { RealtimeModelBadge } from "@/components/app/realtime-model-badge";
import { Logo } from "@/components/brand/logo";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { UserFacingError } from "@/lib/errors";

type AppHeaderProps = {
  user: CurrentUser | null;
  variant?: "app" | "marketing";
};

export function AppHeader({ user, variant = "app" }: AppHeaderProps) {
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const result = await signOut();
      if (result.error) {
        throw new UserFacingError(
          "We couldn’t sign you out. Please try again.",
        );
      }
    },
    onSuccess: () => window.location.assign("/"),
  });
  const initials = user?.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "";
  const marketing = variant === "marketing";

  return (
    <header
      className={
        marketing
          ? "relative z-30 bg-background"
          : "sticky top-0 z-40 border-b bg-background/88 backdrop-blur-xl"
      }
    >
      <div
        className={
          marketing
            ? "mx-auto flex h-[4.5rem] max-w-[76rem] items-center justify-between px-5 sm:px-8"
            : "mx-auto flex h-[4.25rem] max-w-[80rem] items-center justify-between px-4 sm:px-0"
        }
      >
        <div className="flex items-center gap-7">
          <Logo />
          {marketing ? (
            <nav
              aria-label="Homepage sections"
              className="hidden items-center gap-1 text-sm md:flex"
            >
              <a href="#how" className="rounded-full px-4 py-2 hover:bg-card">
                How it works
              </a>
              <a href="#voice" className="rounded-full px-4 py-2 hover:bg-card">
                Voice
              </a>
              <a
                href="#sideboard"
                className="rounded-full px-4 py-2 hover:bg-card"
              >
                Sideboard
              </a>
            </nav>
          ) : (
            <nav className="hidden items-center gap-1 md:flex">
              <Button variant="secondary" render={<Link href="/library" />}>
                <Library />
                Library
              </Button>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <RealtimeModelBadge className="mr-1 hidden sm:inline-flex" />
          {user ? (
            <>
              {marketing ? (
                <Button render={<Link href="/library" />}>Open a book</Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="ml-1 h-10 gap-2 px-1.5 pr-2.5"
                    />
                  }
                >
                  <Avatar className="size-7">
                    {user.image ? (
                      <AvatarImage
                        src={user.image}
                        alt={`${user.name}'s profile picture`}
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <AvatarFallback className="bg-primary text-[0.65rem] text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate text-sm sm:block">
                    {user.name}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={signOutMutation.isPending}
                    onClick={() => signOutMutation.mutate()}
                  >
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" render={<Link href="/sign-in" />}>
                Sign in
              </Button>
              <Button render={<Link href="/library" />}>Open a book</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
