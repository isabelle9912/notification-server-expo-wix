# 🚀 Backend de Notificações - Expo + Wix

Este projeto é um backend simples em **Node.js + Express + TypeScript** que integra **notificações push com Expo** e **eventos do Wix (via Webhook)**.

Ele permite:

- Registrar tokens de dispositivos móveis que utilizam **Expo**.
- Receber eventos do **Wix** (ex.: quando um novo post é publicado).
- Enviar notificações push para todos os dispositivos registrados.
- Gerenciar tokens inválidos automaticamente.

---

## 📦 Tecnologias Utilizadas

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [expo-server-sdk](https://docs.expo.dev/push-notifications/sending-notifications/) (para envio de notificações push)
- [body-parser](https://www.npmjs.com/package/body-parser)

---

## ⚙️ Instalação e Configuração

### 1. Clone o repositório

```bash
git clone https://isabelle9912/notification-server-expo-wix.git
cd notification-server-expo-wix
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto e adicione:

```env
PORT=3000
EXPO_ACCESS_TOKEN=seu_token_aqui
```

> O `EXPO_ACCESS_TOKEN` é **opcional**. Só é necessário se você estiver usando **Expo Access Tokens**.

### 4. Execute o servidor

```bash
npm run dev
```

O backend estará disponível em:

```
http://localhost:3000
```

---

## 🔌 Rotas da API

### **1. Registrar Token**

Rota para salvar o token do dispositivo que receberá notificações.

**POST** `/register`

**Body:**

```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

**Resposta:**

```json
{
  "message": "Token registrado com sucesso!"
}
```

---

### **2. Webhook do Wix**

Rota que recebe os dados quando um novo post é publicado no Wix.

**POST** `/wix-webhook`

**Body (exemplo):**

```json
{
  "id": "12345",
  "title": "Novo  publicado!"
}
```

**Resposta:**

```
Webhook processado.
```

Isso dispara notificações push para todos os tokens registrados.

---

## 📲 Funcionamento das Notificações

1. O **app cliente** registra o token com a rota `/register`.
2. O **Wix** envia um webhook para `/wix-webhook` quando há novo conteúdo.
3. O backend dispara notificações push para todos os tokens válidos.
4. Tokens inválidos são removidos automaticamente.

---

## 🛠 Scripts

- `npm run dev` → Executa o servidor em modo desenvolvimento (com ts-node).
- `npm run build` → Compila o projeto para JavaScript (saída em `dist/`).
- `npm start` → Executa o projeto compilado.

---

## 📌 Observações

- Este backend usa um **banco de dados em memória** (`savedPushTokens`).

  - Reiniciar o servidor limpa os tokens.
  - Para produção, substitua por um banco real (PostgreSQL, MongoDB, etc).

- O tratamento de erros já inclui remoção de tokens inválidos, tanto no envio de tickets quanto nos recibos.

---

## 📖 Referências

- [Expo - Push Notifications](https://docs.expo.dev/push-notifications/overview/)
- [Express.js Docs](https://expressjs.com/)
