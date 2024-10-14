import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  publicActions,
  concat,
  numberToHex,
  size,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { scroll } from "viem/chains";
import { wethAbi } from "./abi/weth-abi";

// Ce script participe au 0x Challenge sur Scroll en fournissant plusieurs fonctionnalités :

// 1. Affichage de la répartition des sources de liquidité en pourcentage
// 2. Intégration de frais d'affiliation et collecte des surplus pour monétisation
// 3. Visualisation des taxes d'achat/vente pour les tokens avec des taxes spécifiques
// 4. Identification de toutes les sources de liquidité sur la blockchain Scroll

const qs = require("qs");

// Chargement des variables d'environnement pour sécuriser les accès
dotenv();
const { PRIVATE_KEY, ZERO_EX_API_KEY, ALCHEMY_HTTP_TRANSPORT_URL } =
  process.env;

// Vérification de la présence des informations obligatoires
if (!PRIVATE_KEY) throw new Error("La clé privée (PRIVATE_KEY) est manquante.");
if (!ZERO_EX_API_KEY) throw new Error("La clé API 0x (ZERO_EX_API_KEY) est manquante.");
if (!ALCHEMY_HTTP_TRANSPORT_URL)
  throw new Error("L'URL de transport Alchemy est manquante.");

// Préparation des en-têtes pour les requêtes vers l'API 0x
const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

// Initialisation du client de portefeuille blockchain
const client = createWalletClient({
  account: privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`),
  chain: scroll,
  transport: http(ALCHEMY_HTTP_TRANSPORT_URL),
}).extend(publicActions); // Extension du client avec des actions publiques pour la blockchain

const [address] = await client.getAddresses();

// Configuration des contrats WETH et wstETH
const weth = getContract({
  address: "0x5300000000000000000000000000000000000004",
  abi: wethAbi,
  client,
});
const wsteth = getContract({
  address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
  abi: erc20Abi,
  client,
});

// Fonction pour afficher la répartition des sources de liquidité en pourcentage
function afficherSourcesLiquidite(route: any) {
  const fills = route.fills;
  const totalBps = fills.reduce((acc: number, fill: any) => acc + parseInt(fill.proportionBps), 0);

  console.log(`${fills.length} sources de liquidité identifiées`);
  fills.forEach((fill: any) => {
    const pourcentage = (parseInt(fill.proportionBps) / 100).toFixed(2);
    console.log(`${fill.source} : ${pourcentage}%`);
  });
}

// Fonction pour afficher les taxes d'achat et de vente des tokens
function afficherTaxesTokens(tokenMetadata: any) {
  const taxeAchatBuyToken = (parseInt(tokenMetadata.buyToken.buyTaxBps) / 100).toFixed(2);
  const taxeVenteBuyToken = (parseInt(tokenMetadata.buyToken.sellTaxBps) / 100).toFixed(2);
  const taxeAchatSellToken = (parseInt(tokenMetadata.sellToken.buyTaxBps) / 100).toFixed(2);
  const taxeVenteSellToken = (parseInt(tokenMetadata.sellToken.sellTaxBps) / 100).toFixed(2);

  if (taxeAchatBuyToken > 0 || taxeVenteBuyToken > 0) {
    console.log(`Taxe à l'achat du token à acheter : ${taxeAchatBuyToken}%`);
    console.log(`Taxe à la vente du token à acheter : ${taxeVenteBuyToken}%`);
  }

  if (taxeAchatSellToken > 0 || taxeVenteSellToken > 0) {
    console.log(`Taxe à l'achat du token à vendre : ${taxeAchatSellToken}%`);
    console.log(`Taxe à la vente du token à vendre : ${taxeVenteSellToken}%`);
  }
}

// Fonction pour récupérer et afficher toutes les sources de liquidité sur Scroll
const recupererSourcesLiquidite = async () => {
  const chainId = client.chain.id.toString(); // Conversion de l'ID de la chaîne en chaîne de caractères
  const sourcesParams = new URLSearchParams({
    chainId: chainId,
  });

  const sourcesResponse = await fetch(
    `https://api.0x.org/swap/v1/sources?${sourcesParams.toString()}`,
    {
      headers,
    }
  );

  const sourcesData = await sourcesResponse.json();
  const sources = Object.keys(sourcesData.sources);
  console.log("Sources de liquidité pour la chaîne Scroll :");
  console.log(sources.join(", "));
};

// Fonction principale pour exécuter les étapes du script
const main = async () => {
  // Étape 4 : Affichage de toutes les sources de liquidité sur Scroll
  await recupererSourcesLiquidite();

  // Définition du montant à vendre
  const decimals = (await weth.read.decimals()) as number;
  const montantVente = parseUnits("0.1", decimals);

  // Paramètres pour les frais d'affiliation et la collecte des surplus
  const fraisAffiliationBps = "100"; // 1%
  const collecteSurplus = "true";

  // Étape 1 : Récupération du prix avec paramètres de monétisation
  const paramsPrix = new URLSearchParams({
    chainId: client.chain.id.toString(),
    sellToken: weth.address,
    buyToken: wsteth.address,
    sellAmount: montantVente.toString(),
    taker: client.account.address,
    affiliateFee: fraisAffiliationBps, // Frais d'affiliation
    surplusCollection: collecteSurplus, // Paramètre pour la collecte des surplus
  });

  const priceResponse = await fetch(
    "https://api.0x.org/swap/permit2/price?" + paramsPrix.toString(),
    {
      headers,
    }
  );

  const price = await priceResponse.json();
  console.log("Récupération du prix pour échanger 0.1 WETH contre wstETH");
  console.log(
    `https://api.0x.org/swap/permit2/price?${paramsPrix.toString()}`
  );
  console.log("Réponse prix : ", price);

  // Étape 2 : Vérification si le taker doit approuver Permit2 pour l'échange
  if (price.issues.allowance !== null) {
    try {
      const { request } = await weth.simulate.approve([
        price.issues.allowance.spender,
        maxUint256,
      ]);
      console.log("Approbation de Permit2 pour dépenser WETH...", request);
      // Approuver
      const hash = await weth.write.approve(request.args);
      console.log(
        "Approbation de Permit2 effectuée.",
        await client.waitForTransactionReceipt({ hash })
      );
    } catch (error) {
      console.log("Erreur lors de l'approbation de Permit2 :", error);
    }
  } else {
    console.log("WETH déjà approuvé pour Permit2");
  }

  // Étape 3 : Récupération du devis avec les paramètres de monétisation
  const paramsDevis = new URLSearchParams();
  for (const [key, value] of paramsPrix.entries()) {
    paramsDevis.append(key, value);
  }

  const quoteResponse = await fetch(
    "https://api.0x.org/swap/permit2/quote?" + paramsDevis.toString(),
    {
      headers,
    }
  );

  const quote = await quoteResponse.json();
  console.log("Récupération du devis pour échanger 0.1 WETH contre wstETH");
  console.log("Réponse devis : ", quote);

  // Étape 1 : Affichage de la répartition des sources de liquidité
  if (quote.route) {
    afficherSourcesLiquidite(quote.route);
  }

  // Étape 3 : Affichage des taxes d'achat/vente pour les tokens
  if (quote.tokenMetadata) {
    afficherTaxesTokens(quote.tokenMetadata);
  }

  // Étape 2 : Affichage des informations de monétisation
  if (quote.affiliateFeeBps) {
    const fraisAffiliation = (parseInt(quote.affiliateFeeBps) / 100).toFixed(2);
    console.log(`Frais d'affiliation : ${fraisAffiliation}%`);
  }

  if (quote.tradeSurplus && parseFloat(quote.tradeSurplus) > 0) {
    console.log(`Surplus de transaction collecté : ${quote.tradeSurplus}`);
  }

  // Étape 4 : Signature de permit2.eip712 renvoyé par le devis
  let signature: Hex | undefined;
  if (quote.permit2?.domain && quote.permit2?.permitData) {
    try {
      signature = await client.signTypedData(quote.permit2);
    } catch (error) {
      console.log("Erreur lors de la signature de Permit2 :", error);
      return;
    }
  }

  // Étape 5 : Transmission de la transaction signée à Permit2
  const paramsTransaction = new URLSearchParams();
  for (const [key, value] of paramsDevis.entries()) {
    paramsTransaction.append(key, value);
  }
  paramsTransaction.append("signature", signature || "");

  const executeResponse = await fetch(
    "https://api.0x.org/swap/permit2/execute?" + paramsTransaction.toString(),
    {
      headers,
    }
  );
  const execution = await executeResponse.json();
  console.log("Hash de la transaction d'échange :", execution.hash);
  console.log(
    `Suivre la transaction : https://scrollscan.co/tx/${execution.hash}`
  );
};

main();
