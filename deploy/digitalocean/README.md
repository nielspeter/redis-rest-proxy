# Redis REST Proxy on Digital Ocean

This is a guide to deploy the Redis REST Proxy on a Digital Ocean Droplet using Cloudflare DNS, Docker Compose, Redis, and Traefik.

## Prerequisites

- [Create a Digital Ocean Docker Droplet](https://docs.digitalocean.com/products/droplets/how-to/create/).
- [Create a volume](https://docs.digitalocean.com/products/volumes/how-to/create/) for the service to persist data and attach it to the droplet.
- [Configure the droplet firewall](https://docs.digitalocean.com/products/networking/firewalls/how-to/create/) to allow incoming traffic on ports 80 and 443.
- [Create a Cloudflare account](https://www.cloudflare.com/) and add your domain with Cloudflare DNS using the droplet's public IP address.
- [Create a Docker context](https://www.docker.com/blog/how-to-deploy-on-remote-docker-hosts-with-docker-compose/) for the droplet.

## Configuration

- **In the `traefik.yml` file:**

  - Replace the `<YOUR_CLOUDFLARE_EMAIL>` placeholder with your Cloudflare email address.  
    _Why?_ This email is used by Let's Encrypt to:
    - Send expiration notifications for your TLS certificates.
    - Register your ACME (Automated Certificate Management Environment) account.

- **In the `docker-compose.yml` file:**
  - Replace the `<YOUR_DOMAIN>` placeholder with your domain name.
  - Replace the `<YOUR_SUPER_SECRET_TOKEN>` with a secure token to authenticate client requests to the proxy.
  - Replace `<YOUR_CLOUDFLARE_EMAIL>` and `<YOUR_CLOUDFLARE_API_KEY>` with your Cloudflare credentials.  
    _Why?_ These credentials allow Traefik to:
    - Automatically create/update DNS records (`TXT` challenges) for Let's Encrypt certificate validation.
    - Renew certificates without manual intervention (critical for HTTPS automation).
  - Create a volume for the `redis` service to persist data and attach it to the droplet.

## Deployment

1. Clone the repository:

```sh
   git clone https://github.com/nielspeter/redis-rest-proxy.git
   cd redis-rest-proxy/deploy/digitalocean
```

2. Update the configuration files with your details.
3. Create context (SSH access must already work)

```sh
docker context create digitalocean --docker "host=ssh://root@203.0.113.10"
```

4. Switch context

```sh
docker context use digitalocean
```

5. Deploy (from your local machine)

```sh
docker compose -f docker-compose.digitalocean.yaml up -d
```

## Troubleshooting

- nsure that all placeholders in the configuration files are replaced with your actual values.
- Check the logs of the services for any errors:

```sh
docker-compose -f docker-compose.digitalocean.yaml logs
```

That's it! You have successfully deployed the Redis REST Proxy on a Digital Ocean Droplet.
