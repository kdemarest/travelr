# Travelr Development Environment Setup

The goal is to make the Windows host do almost nothing beyond running Docker Desktop and VS Code, while every dev tool (Node.js, npm, Terraform, AWS CLI, etc.) lives inside a Linux container that mirrors production.

## 1. Windows prerequisites
- Install the latest Windows 11 updates and ensure hardware virtualization is enabled in BIOS/UEFI.
- Sign in with an account that can install apps and tweak Hyper-V/WSL features (Docker Desktop relies on them).

### What lives on Windows vs. inside the container?
- **Windows host:**
   - Docker Desktop
   - VS Code (with Dev Containers extension)
   - A batch file or two
   - WSL2 (which docker will install for you)
   
- **Dev container (Linux):**
   - Node.js + npm
   - nodemon
   - git
   - Terraform/AWS CLI
   - running the actual Travelr app
   - secrets, injected from window

## 2. Install Docker Desktop
- Download Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/)
- Install with the **Use WSL 2 based engine** option enabled.
- Run Docker Desktop
- In windows settings / Personalization / Taskbar / Other System Tray Icons find the docker icon and set it to On
- Right-click Docker on the taskbar and pick Change Settings
   - Go to Settings / General
   - Click "Start Docker Desktop when you sign in"
   - Unclick "Open Docker Dashboard when Docker Desktop starts"
   - Go to Settings / Resources / File Sharing
  - Set to `%USERPROFILE%` (for example `C:\Users\<username>`). You must ALSO use the explicit `-v` host path when running docker containers or when configuring the dev container.
   - Close the docker GUI
- Run cmd.exe or powershell. Run `docker run hello-world` to confirm install

## 3. Install VS Code + extensions
- Install Visual Studio Code (https://code.visualstudio.com/).
- Add the **Remote Development** extension pack (includes Dev Containers).

## 4. Clone the repository
- Choose a workspace folder, e.g. `%USERPROFILE%\code`.
- In PowerShell:
  ```powershell
  cd %USERPROFILE%\code
  git clone https://github.com/kdemarest/Travelr.git
  cd Travelr
  ```
- Future Windows machines should pull the repo to the same path so Docker bind mounts remain simple.

## 5. Open the repo inside a dev container
- Launch VS Code in the repo (`code .`).
- When prompted, or via the Command Palette, run **Dev Containers: Reopen in Container**.
- The repo already includes `.devcontainer/Dockerfile` + `devcontainer.json`, which build from the `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm` image and install Terraform automatically. VS Code will reuse this definition and mount the workspace at `/workspaces/travelr`.
- After the container finishes building (first run can take several minutes):
  ```bash
  npm install
  npm run build --workspace client
  ```
  These run inside Linux, against the same `C:\Users\kende\code\Travelr` files mounted at `/workspaces/Travelr`.

## 6. Running the app
- Inside the container terminal:
  ```bash
  npm run dev --workspace server
  npm run dev --workspace client
  ```
- If you prefer Windows terminals, `launch.bat` still opens two local `cmd.exe` windows; both commands read/write the same workspace files.

## 7. Managing secrets
- Do **not** rely on Windows Credential Manager once you run inside Docker.
- Use an `.env` file (ignored by git) or a secrets manager to supply `OPENAI_API_KEY`, `GOOGLE_CS_API_KEY`, and `GOOGLE_CS_CX` via environment variables.
- For local dev, create `.env.local` with those values and load it via `docker compose`, VS Code dev container settings (`"remoteEnv"`), or a tool like `direnv`.

## 8. Terraform / infrastructure tooling (optional)
- Terraform is already baked into the dev container. Keep IaC code under `infra/` or `devenvsetup/terraform/` so that re-provisioning the environment years later is just `terraform init && terraform apply`.

## 9. Verification checklist
- `npm run build --workspace client` succeeds.
- `npm run dev --workspace server` logs "Travelr API listening on http://localhost:4000".
- `npm run dev --workspace client` opens Vite on http://localhost:5173.
- VS Code Dev Container status bar shows `Dev Container: travelr` (meaning commands are running inside Docker).

Document any additional machine-specific tweaks (graphics drivers, VPN requirements, proxy settings) in this directory so future setups remain repeatable.
