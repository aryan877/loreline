"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Library, LogOut } from "lucide-react";
import type { CurrentUser } from "@loreline/contracts/auth";
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

export function AppHeader({ user }: { user: CurrentUser }) {
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
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.25rem] max-w-[80rem] items-center justify-between px-4 sm:px-0">
        <div className="flex items-center gap-7">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            <Button variant="secondary" render={<Link href="/library" />}>
              <Library />
              Library
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-1">
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
        </div>
      </div>
    </header>
  );
}
