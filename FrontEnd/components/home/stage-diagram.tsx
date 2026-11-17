import { HandIcon, HeadphonesIcon, MicIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SEATS = 5;
const LISTENERS = 7;

/** Static diagram of how a space works: five seats on stage, everyone else in the audience. */
export function StageDiagram({ className }: { className?: string }) {
  return (
    <Card className={cn("w-full", className)} aria-label="How a space works">
      <CardHeader>
        <CardTitle>On stage</CardTitle>
        <CardDescription>The host holds the first seat. Up to four more seats open when the host approves a request.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="grid grid-cols-5 gap-2" aria-hidden>
          {Array.from({ length: SEATS }, (_, i) => (
            <li key={i} className="flex flex-col items-center gap-2">
              <Avatar size="lg" className={cn("size-12", i === 0 && "ring-2 ring-primary ring-offset-2 ring-offset-card")}>
                <AvatarFallback className={cn(i !== 0 && "bg-transparent outline-1 -outline-offset-1 outline-dashed outline-border")}>
                  {i === 0 ? <MicIcon className="size-5 text-primary" /> : null}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground">{i === 0 ? "Host" : "Open"}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HeadphonesIcon className="size-4" />
            Listening
          </div>
          <ul className="flex flex-wrap gap-2" aria-hidden>
            {Array.from({ length: LISTENERS }, (_, i) => (
              <li key={i}>
                <Avatar size="sm">
                  <AvatarFallback>
                    <UserIcon className="size-3" />
                  </AvatarFallback>
                </Avatar>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">
          <HandIcon data-icon="inline-start" />
          Ask to speak
        </Badge>
        Listeners raise a hand. The host decides.
      </CardFooter>
    </Card>
  );
}
