import { Grid } from '@react-three/drei'

export function Floor() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#242424" />
      </mesh>

      <Grid
        args={[100, 100]}
        cellColor="#4d4d4d"
        cellSize={1}
        sectionColor="#7a7a7a"
        sectionSize={5}
        fadeDistance={40}
        infiniteGrid
      />
    </>
  )
}
