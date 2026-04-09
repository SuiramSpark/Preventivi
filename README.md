# Preventivi PWA

PWA locale per creare preventivi senza login e senza database esterno obbligatorio.

## Funzioni incluse

- dashboard con metriche e preventivi recenti
- lista preventivi con ricerca, filtri e ordinamento
- editor preventivo con righe, cliente, note e parametri economici
- anteprima visiva in tempo reale, non PDF reale
- generazione PDF solo quando premi il pulsante dedicato
- pulsanti condividi e stampa
- template stile `Word` e `PowerPoint`
- impostazioni azienda e configurazione Firebase opzionale
- salvataggio locale nel browser tramite IndexedDB
- struttura PWA con manifest e service worker

## Avvio in locale

Per usare la PWA correttamente serve aprirla via server locale, non con doppio click sul file.

### Prima volta

```powershell
npm install
```

### Sviluppo

```powershell
npm run dev
```

Poi apri l'indirizzo mostrato nel terminale, di solito:

```text
http://localhost:5173
```

### Preview build

```powershell
npm run build
npm run preview
```

## Firebase

L'app funziona gia in locale senza Firebase.

Se in futuro vuoi collegare database e storage cloud:

1. vai nella sezione `Impostazioni`
2. inserisci i parametri Firebase
3. copia lo snippet generato
4. collega Firestore e Storage dove ti serve

## Git e GitHub Desktop

Il repository Git locale è già inizializzato.

Per collegarlo a GitHub Desktop:

1. apri GitHub Desktop
2. scegli `File > Add local repository`
3. seleziona questa cartella:

```text
c:\Users\4mktg\OneDrive\Desktop\Preventivi
```

4. da GitHub Desktop puoi fare commit, vedere la cronologia e pubblicare su GitHub

## Note

- il PDF usa librerie caricate al bisogno dal CDN solo quando premi `Genera PDF`
- la preview resta sempre HTML/CSS, quindi leggera e immediata
- la stampa usa il layout della preview
