import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { Button, Card } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <Card.Content>
          <div className="flex flex-col items-center text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              <FlaskConical size={22} />
            </span>
            <h1 className="mt-4 text-lg font-medium text-[var(--foreground)]">Paper Baker</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Manage and read research papers</p>
            <Button variant="primary" fullWidth className="mt-6" onPress={signIn}>
              Sign in with Google
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
