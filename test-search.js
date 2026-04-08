import axios from 'axios';
axios.get('http://localhost:3000/api/search?query=metal')
  .then(res => {
    const data = res.data;
    const formattedResults = data.data.results.map((item) => {
      const decodeHTML = (html) => html;
      
      const highResImage = item.image?.find((img) => img.quality === '500x500')?.link || item.image?.[0]?.link || '';
      const highResAudio = item.downloadUrl?.find((url) => url.quality === '320kbps')?.link || item.downloadUrl?.[item.downloadUrl.length - 1]?.link || '';
      
      return {
        id: item.id,
        title: decodeHTML(item.name || ''),
        artist: decodeHTML(item.primaryArtists || ''),
        coverUrl: `/api/proxy-image?url=${encodeURIComponent(highResImage)}`,
        audioUrl: `/api/proxy-audio?url=${encodeURIComponent(highResAudio)}`,
        duration: parseInt(item.duration || '0', 10)
      };
    }).filter((song) => song.audioUrl);
    console.log(JSON.stringify(formattedResults[0], null, 2));
  })
  .catch(err => console.error(err.message));
