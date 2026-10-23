interface ConnectSwiggyProps {
  onConnected: () => void;
}

export function ConnectSwiggy({ onConnected }: ConnectSwiggyProps) {
  return (
    <div className="connect-gate">
      <h2>Connect Swiggy</h2>
      <p>
        Bolo needs access to your Swiggy account to search restaurants and manage your cart.
        You will sign in with phone + OTP.
      </p>
      <a className="connect-button" href="/auth/swiggy/login" onClick={onConnected}>
        Connect Swiggy
      </a>
    </div>
  );
}
