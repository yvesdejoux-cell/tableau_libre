# Tableau Libre

Tableau blanc interactif libre pour la classe : stylo, formes, texte, pages, règle, équerre, rapporteur, compas, rideau, images, sons et vidéos. Enregistre au format `.ubz` d'OpenBoard et importe les fichiers `.gwb` d'Interwrite Workspace.

## Installer sous Windows

1. Ouvrir la page des [versions publiées](https://github.com/yvesdejoux-cell/tableau_libre/releases/latest).
2. Télécharger le fichier `.exe` et le lancer.

L'installeur n'est pas signé. Si Windows affiche « Windows a protégé votre ordinateur », cliquer sur « Informations complémentaires », puis « Exécuter quand même ».

Le numéro de version est affiché dans la barre de titre et en haut, au milieu de la fenêtre.

## Développement

Il faut [Node.js](https://nodejs.org/) et [Rust](https://www.rust-lang.org/).

```bash
npm install
npm run tauri dev
```

```bash
npm test
```

Le numéro de version se change dans `package.json` uniquement. Pousser une étiquette `v*` compile l'installeur et le publie.

## Licence

[GNU GPL version 3](LICENSE). L'installeur contient `@ffmpeg/core`, lui aussi sous licence GPL.
