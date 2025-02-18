import {
    Links,
    Meta,
    Outlet,
    Scripts,
    LiveReload,
  } from "@remix-run/react";
  
  export default function App() {
    return (
      <html lang="en">
        <head>
          <Meta />
          <Links />
        </head>
        <body>
          <Outlet />
          <Scripts />
          <LiveReload />
        </body>
      </html>
    );
  }
  