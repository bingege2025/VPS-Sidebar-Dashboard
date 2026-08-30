<!-- Chrome Web Store "Detailed Description" — Version française. Texte brut, prêt à coller. Le store n'affiche pas de HTML/Markdown ; conservez les sauts de ligne. -->

VPS Dashboard

Une extension Chrome légère et respectueuse de la vie privée pour gérer des serveurs VPS chez plusieurs fournisseurs et panneaux de contrôle.

Gérez vos serveurs directement depuis la barre latérale du navigateur — consultez le statut, l'utilisation des ressources, la bande passante et effectuez des actions d'alimentation sans ouvrir plusieurs tableaux de bord de fournisseurs.

LOCAL-FIRST. SANS COMPTE. Vos identifiants API ne quittent jamais votre navigateur.

POURQUOI VPS DASHBOARD ?

- Un tableau de bord unique pour tous vos VPS
- Accès rapide depuis la barre latérale de Chrome
- Architecture local-first — vos données serveur et vos identifiants restent sur votre appareil. Seuls des événements d'utilisation anonymes et non identifiants sont envoyés à Google Analytics, et vous pouvez désactiver cela à tout moment dans les paramètres.
- Prise en charge de plusieurs fournisseurs
- Conçu pour les utilisateurs de VPS, pas pour la surveillance en entreprise

VPS Dashboard se concentre sur la gestion côté fournisseur plutôt que sur la surveillance au niveau du système d'exploitation. Il complète des outils de surveillance spécialisés — il ne les remplace pas.

FOURNISSEURS PRIS EN CHARGE

Connectez-vous à 9 fournisseurs. Certains sont stables, d'autres expérimentaux — consultez les guides de configuration de l'extension pour les détails.

FONCTIONNALITÉS CLÉS

Prise en charge de plusieurs fournisseurs
Connectez-vous à plusieurs fournisseurs VPS via des pilotes API dédiés. Gérez-les tous depuis une interface unique.

Vue des ressources côté fournisseur
Affichez le statut, la mémoire, le disque, la bande passante, l'IP, le nom d'hôte, le système d'exploitation et plus encore — le tout via l'API de votre fournisseur.

Contrôles d'alimentation intelligents
Démarrez, arrêtez et redémarrez les serveurs directement depuis le popup (si le fournisseur le prend en charge). Des boîtes de dialogue de confirmation évitent les actions accidentelles. Les actions d'alimentation s'adaptent à l'état du serveur de chaque fournisseur (par ex. les états de transition comme « pending » ou « stopping » sont détectés automatiquement).

Opérations par lot
Actualisez, redémarrez ou arrêtez plusieurs serveurs en une seule fois. Les résultats sont indiqués individuellement pour chacun.

Tags & recherche
Organisez les serveurs avec des étiquettes personnalisées. Filtrez et recherchez pour les trouver instantanément.

Serveur par défaut
Définissez un serveur par défaut qui se charge automatiquement à l'ouverture de l'extension.

Mode confidentialité
Floutez les IP, les noms d'hôte et les informations sensibles en un clic — sûr pour les captures d'écran et le partage d'écran.

Import / export de configuration
Exportez votre configuration sous forme de sauvegarde JSON. Importez-la lors du changement de navigateur ou d'appareil.

Rappels d'expiration
L'extension vérifie vos serveurs toutes les 6 heures et vous avertit 30, 7 et 3 jours avant l'expiration. Les serveurs expirés vous rappellent quotidiennement jusqu'au renouvellement. Un commutateur principal global et un opt-out par serveur sont inclus.

Dates d'expiration automatiques
Pour les fournisseurs qui exposent des dates de facturation, la date est récupérée automatiquement. La saisie manuelle prime toujours.
Les dates issues de l'API peuvent être inexactes — vérifiez-les.

Export vers le calendrier (.ics)
Exportez les serveurs vers un fichier calendrier .ics avec des alarmes à chaque seuil. Importez-les dans Google Calendar, Apple Calendar, Outlook ou tout calendrier conforme aux normes.

Mode sombre
Thèmes clair et sombre inclus.

Multilingue
English · 中文 · Deutsch · Français · Русский

CONFIDENTIALITÉ

- Traitement local — vos informations serveur s'exécutent dans votre navigateur ; seule une analyse anonyme est envoyée à Google Analytics
- Aucun compte requis — zéro inscription
- Aucune collecte de clés API, d'identifiants ou de données sensibles
- Appels API directs vers votre fournisseur — les requêtes serveur vont directement à votre fournisseur ; la seule requête à un tiers est l'analyse anonyme facultative
- Votre configuration serveur et vos identifiants restent dans le stockage local de Chrome

ANALYSE ANONYME

L'extension peut envoyer des événements d'utilisation anonymes (par ex. ouverture de l'extension, clic sur actualiser/redémarrer, consultation d'un guide) à Google Analytics. Ces événements ne contiennent que le nom de la fonction et le type de fournisseur — jamais de clés API, d'identifiants, de noms d'hôte ou de contenu serveur. Comme pour toute requête à un service tiers, Google reçoit l'IP réseau utilisée pour envoyer chaque événement ; nous ne mettons aucune IP dans les données d'événement. Vous pouvez désactiver entièrement l'analyse dans les paramètres.

CE QUE VPS DASHBOARD NE FAIT PAS

Cette extension est volontairement centrée sur la gestion côté fournisseur.

Elle ne :
- N'installe pas d'agent dans votre VPS
- Ne surveille pas continuellement le temps de disponibilité
- Ne remplace pas les plateformes de surveillance
- Ne téléverse ni ne collecte vos identifiants API ou la configuration de votre serveur

PREMIERS PAS

Lors de la première ouverture de l'extension sans serveur configuré, un écran « Pour commencer » demande quel fournisseur vous souhaitez connecter. Choisissez-en un et les paramètres s'ouvrent avec ce type de fournisseur déjà sélectionné. Vous pouvez l'ignorer et ajouter un serveur manuellement :

1. Ouvrez les paramètres de l'extension
2. Ajoutez un profil de serveur
3. Sélectionnez le type de fournisseur
4. Saisissez votre point de terminaison API et vos identifiants
5. Testez la connexion
6. Ouvrez le popup pour consulter le statut et effectuer des actions

Pour les instructions détaillées de configuration par fournisseur, consultez les guides intégrés à l'extension.

RETOUR D'EXPÉRIENCE

Les demandes de fonctionnalités, les rapports de bugs et les rapports de compatibilité des fournisseurs sont les bienvenus. Utilisez le lien de retour intégré dans l'extension pour créer un ticket GitHub pré-rempli.

N'incluez aucune clé API, secret, token, adresse IP, nom d'hôte ou autre information sensible dans les rapports publics.
