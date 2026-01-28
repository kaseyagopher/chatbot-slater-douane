export default {
  openapi: '3.0.3',
  info: {
    title: 'ChatBot API',
    version: '1.0.0',
    description: "Documentation minimale pour les endpoints du ChatBot",
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local server' }
  ],
  paths: {
    '/': {
      get: {
        summary: 'Racine',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'API Chatbot opérationnelle' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/session': {
      post: {
        summary: 'Créer ou récupérer une session',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SessionRequest' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Session existante ou nouvellement créée',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SessionResponse' }
              }
            }
          }
        }
      }
    },
    '/api/chat': {
      post: {
        summary: 'Envoyer un message au chat',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatRequest' },
              examples: {
                simple: { value: { sessionId: 'string', message: 'Bonjour' } }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Réponse du chat',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatResponse' }
              }
            }
          },
          '400': { description: 'Requête invalide' },
          '440': { description: 'Session expirée' }
        }
      }
    },
    '/api/session/messages': {
      get: {
        summary: "Lister les messages d'une session",
        parameters: [
          {
            name: 'sessionId',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'ID de la session à récupérer'
          }
        ],
        responses: {
          '200': {
            description: 'Liste des messages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messages: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Message' }
                    }
                  }
                }
              }
            }
          },
          '400': { description: 'sessionId manquant' }
        }
      }
    },
    '/api/support/message': {
      post: {
        summary: 'Technicien envoie un message dans une session',
        description: 'Endpoint utilisé par un technicien pour envoyer un message et lier son identifiant d\'agent à ce message.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SupportMessageRequest' },
              examples: {
                example1: { value: { sessionId: 'sess_abc123', technicianId: 'tech_1', message: 'Je regarde votre problème' } }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Message enregistré',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SupportMessageResponse' }
              }
            }
          },
          '400': { description: 'Requête invalide (champs manquants)' },
          '500': { description: 'Erreur serveur' }
        }
      }
    }
  },
  components: {
    schemas: {
      ChatRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          sessionId: { type: 'string', nullable: true },
          message: { type: 'string', example: 'Bonjour' }
        }
      },
      ChatResponse: {
        type: 'object',
        properties: {
          answer: { type: 'string', example: 'Je suis un chatbot.' },
          forwarded: { type: 'boolean' }
        }
      },
      SessionRequest: {
        type: 'object',
        properties: { /* optional fields */ }
      },
      SessionResponse: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', example: 'sess_abc123' }
        }
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '1' },
          session_id: { type: 'string' },
          role: { type: 'string' },
          content: { type: 'string' },
          agent_id: { type: 'string', nullable: true },
          metadata: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      SupportMessageRequest: {
        type: 'object',
        required: ['sessionId','technicianId','message'],
        properties: {
          sessionId: { type: 'string', example: 'sess_abc123' },
          technicianId: { type: 'string', example: 'tech_1' },
          message: { type: 'string', example: 'Je regarde votre problème' }
        }
      },
      SupportMessageResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true }
        }
      }
    }
  }
};
