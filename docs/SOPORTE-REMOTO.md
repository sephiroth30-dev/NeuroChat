# Soporte remoto — cómo funciona y cómo dejarlo operativo

El soporte remoto de NeuroChat usa **WebRTC**: el vídeo de la pantalla y los
eventos de teclado/ratón viajan **directamente entre los dos equipos**, sin
pasar por ningún servidor. La señalización previa (quién se conecta con quién)
va por el WebSocket propio de NeuroChat en el puerto 45679.

---

## Requisito 1 — Regla de firewall de aplicación (misma red)

**Esto es lo que hacía que la sesión se quedara en "Conectando…".**

WebRTC no usa un puerto fijo: negocia **puertos UDP efímeros aleatorios**. Por
eso las reglas de los puertos 45678/45679/45680 no le sirven de nada — hace
falta una regla que autorice **al ejecutable** completo:

```
netsh advfirewall firewall add rule name="NeuroChat App" dir=in action=allow ^
  profile=any program="%LOCALAPPDATA%\Programs\NeuroChat\NeuroChat.exe" protocol=any
```

En una instalación por GPO esto lo hace automáticamente
`scripts/gpo/1-limpieza-startup.bat` (paso 5), que recorre los perfiles de
usuario del equipo y registra la regla para cada instalación encontrada.

> Como la instalación es por-usuario, la regla de un usuario nuevo aparece en
> el **siguiente arranque** después de su primera instalación. En equipos
> fuera de GPO, la propia app intenta crearla al iniciar (pide elevación una
> vez, hasta 3 intentos).

Para verificar en un equipo concreto:

```
netsh advfirewall firewall show rule name="NeuroChat App"
```

## Requisito 2 — Servidor TURN (solo para redes distintas)

En la **misma red local** no hace falta nada más: los equipos se ven
directamente.

Entre **redes distintas** (otra sede, VPN, teletrabajo) los equipos están
detrás de NAT y no pueden verse directamente. NeuroChat ya consulta servidores
STUN públicos, pero STUN **no puede atravesar NAT simétrico**, que es lo
habitual en redes corporativas. En ese escenario hace falta un **servidor
TURN**, que retransmite el tráfico entre ambos extremos.

**Sin TURN, el soporte remoto entre redes distintas no va a conectar nunca.**

### Configurarlo en la app

Ajustes → Soporte Remoto → *Servidor TURN*. Los tres campos son obligatorios:

| Campo | Ejemplo |
|---|---|
| Servidor | `turn:soporte.neurofic.com:3478` |
| Usuario | `neurochat` |
| Contraseña | (la del servidor) |

> Las credenciales se guardan sin cifrar en la base de datos local del usuario.
> Conviene usar una cuenta dedicada solo para TURN.

### Montar el servidor (coturn)

En un servidor Linux con IP pública:

```bash
sudo apt install coturn
```

`/etc/turnserver.conf`:

```
listening-port=3478
fingerprint
lt-cred-mech
user=neurochat:UNA_CONTRASEÑA_LARGA
realm=neurofic.com
# IP pública del servidor
external-ip=203.0.113.10
no-tls
no-dtls
```

Abrir en el firewall del servidor: **3478 TCP y UDP**, más el rango de relay
(por defecto 49152-65535 UDP).

```bash
sudo systemctl enable --now coturn
```

---

## Diagnóstico rápido

| Síntoma | Causa probable |
|---|---|
| "Conectando…" y la ventana se cierra sola | Versión anterior a 2.4.0 — actualizar |
| "ICE falló" | Falta la regla de firewall de aplicación, o redes distintas sin TURN |
| "El equipo remoto no tiene permiso para compartir su pantalla" | Permiso de captura denegado en el equipo remoto |
| "no respondió a la solicitud" | El otro equipo no tiene NeuroChat abierto, o no llegó la señalización |
| Conecta pero no se ve la pantalla | Permiso de grabación de pantalla en el equipo remoto |
