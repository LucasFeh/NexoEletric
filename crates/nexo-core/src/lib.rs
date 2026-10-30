//! nexo-core: o coracao do NexoEletric em Rust -- sem interface.
//! - `model`: a placa no formato pcbmirror-v1 (board.js);
//! - `jsfile`: le os arquivos .js do projeto sem executar nada;
//! - `changes`: o motor de mudancas (changes.js -> placa efetiva);
//! - `layers`: a tabela de camadas do Altium (nomes, pares, cores, ordem de desenho);
//! - `font`: a fonte vetorial da serigrafia;
//! - `geom`: geometria plana;
//! - `scene`: a placa em malhas para a GPU;
//! - `pick`: selecao (indice espacial) e propriedades.

pub mod changes;
pub mod font;
pub mod geom;
pub mod jsfile;
pub mod layers;
pub mod model;
pub mod pick;
pub mod project;
pub mod scene;

pub use model::Board;
